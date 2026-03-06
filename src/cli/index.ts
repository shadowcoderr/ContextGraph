// Developer: Shadow Coderr, Architect

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { RuntimeController, RuntimeMode } from '../core/runtime';
import { loadConfig } from '../config/loader';
import { isValidUrl } from '../utils/validators';
import { logger } from '../utils/logger';

const program = new Command();

program
  .name('context-graph')
  .description('A deterministic "Flight Data Recorder" for web applications')
  .version('0.3.0');

program
  .argument('[startUrl]', 'Starting URL (optional)')
  .option('-m, --mode <type>', 'Operating mode (browser|recorder)', 'browser')
  .option('-u, --url <url>', 'Starting URL (optional)')
  .option('-o, --output <path>', 'Output directory', './context-graph-output')
  .option('-c, --config <path>', 'Custom config file path')
  .option('-v, --viewport <WxH>', 'Viewport size (default: 1920x1080)', '1920x1080')
  .option('--headless', 'Run in headless mode', false)
  .option('--no-screenshots', 'Disable screenshot capture')
  .option('--no-network', 'Disable network logging')
  .option('--recorder-capture', 'In recorder mode, replay the recorded script to capture full artifacts (DOM/a11y/locators/network/screenshots)', false)
  .option('--verbose', 'Enable verbose logging', false);

program.action(async (startUrl, options) => {
  // Handle unhandled rejections
  process.on('unhandledRejection', (reason, promise) => {
    logger.error(`Unhandled Rejection at:${promise}, reason:${reason}`);
  });

  try {
    // Load configuration
    const configPath = options.config;
    let config = await loadConfig(configPath);

    // Override config with CLI options
    if (options.output) config.storage.outputDir = options.output;
    if (options.headless) config.browser.headless = true;
    if (options.viewport) {
      const [width, height] = options.viewport.split('x').map(Number);
      config.browser.viewport = { width, height };
    }
    if (options.noScreenshots) config.capture.screenshots.enabled = false;
    if (options.noNetwork) config.capture.network.enabled = false;
    if (options.verbose) logger.level = 0; // DEBUG

    // Validate mode or ask for it
    let mode: RuntimeMode;
    if (options.mode && ['browser', 'recorder'].includes(options.mode)) {
      mode = options.mode as RuntimeMode;
    } else {
      const modeAnswers = await inquirer.prompt([
        {
          type: 'list',
          name: 'mode',
          message: 'Select operation mode:',
          choices: [
            { name: 'Browser (Capture Context)', value: 'browser' },
            { name: 'Recorder (Generate Script)', value: 'recorder' }
          ],
        },
      ]);
      mode = modeAnswers.mode as RuntimeMode;
    }

    // Determine start URL (CLI option takes precedence, then positional arg)
    let finalStartUrl = options.url || startUrl;
    if (finalStartUrl && !isValidUrl(finalStartUrl)) {
      throw new Error(`Invalid URL: ${finalStartUrl}`);
    }

    // If no URL provided, ask for it
    if (!finalStartUrl) {
      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'url',
          message: 'Enter starting URL:',
          validate: (input) => isValidUrl(input) || 'Please enter a valid URL',
        },
      ]);
      finalStartUrl = answers.url;
    }

    // Initialize runtime
    const spinner = ora('Initializing...').start();
    const runtime = new RuntimeController(config, mode);
    await runtime.initialize();

    // Branch based on mode
    if (mode === RuntimeMode.RECORDER) {
      // Recorder mode - start Playwright codegen
      spinner.succeed('Runtime initialized');
      await runtime.startRecorder(finalStartUrl, { captureArtifacts: Boolean(options.recorderCapture) });
      return;
    }

    // Browser mode - proceed with existing logic
    // Launch browser
    spinner.text = 'Launching browser...';
    const browser = await runtime.launchBrowser();
    const context = await runtime.createContext(browser);

    // Create page and navigate
    spinner.text = 'Setting up page...';
    const page = await context.newPage();
    await runtime.setupPage(page);

    if (finalStartUrl) {
      spinner.text = `Navigating to ${finalStartUrl}...`;
      await page.goto(finalStartUrl, { waitUntil: 'networkidle' });
      // Give a moment for any post-load scripts to run
      await new Promise(r => setTimeout(r, 1000));
      // Ensure initial page is captured (fallback if events didn't fire)
      await runtime.capturePageIfNeeded(page);
    }

    spinner.stop();
    console.log(chalk.green('✓ Browser ready!'));
    console.log(chalk.blue('Navigate through the application. Each page will be captured automatically.'));
    console.log(chalk.yellow('Press Ctrl+C to stop and save all data...'));

    // Handle browser close event
    let isShuttingDown = false;
    const shutdown = async () => {
      if (isShuttingDown) return;
      isShuttingDown = true;
      try {
        console.log('\n' + chalk.yellow('Shutting down gracefully...'));
        await runtime.shutdown();
        console.log(chalk.green('✓ All data saved!'));
        console.log(chalk.blue(`View manifest: ${config.storage.outputDir}/global_manifest.json`));
        setTimeout(() => process.exit(0), 100);
      } catch (error) {
        const err = error as Error;
        console.error(chalk.red(`Error during shutdown: ${err.message}`));
        setTimeout(() => process.exit(1), 100);
      }
    };

    // Listen for browser disconnect
    runtime.onBrowserDisconnect(shutdown);

    // Wait for user to finish
    process.on('SIGINT', shutdown);

  } catch (error) {
    const err = error as Error;
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
});

program.parse();
