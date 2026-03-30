#!/usr/bin/env node

// Developer: Shadow Coderr, Architect

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { RuntimeController, RuntimeMode } from '../core/runtime';
import { loadConfig } from '../config/loader';
import { isValidUrl, normalizeUrl } from '../utils/validators';
import { logger, LogLevel } from '../utils/logger';
import { getVersion } from '../utils/version';

const program = new Command();

program
  .name('context-graph')
  .description('A deterministic "Flight Data Recorder" for web applications')
  .version(getVersion());

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
  .option('--recorder-capture', 'In recorder mode, replay the recorded script to capture full artifacts', false)
  .option('--verbose', 'Enable verbose debug logging', false);

program.action(async (startUrl, options) => {
  // Enable verbose logging when requested — otherwise WARN is default
  if (options.verbose) {
    logger.level = LogLevel.DEBUG;
  }

  process.on('unhandledRejection', (reason) => {
    logger.error(`Unhandled rejection: ${reason}`);
  });

  try {
    const configPath = options.config;
    let config = await loadConfig(configPath);

    if (options.output) config.storage.outputDir = options.output;
    if (options.headless) config.browser.headless = true;
    if (options.viewport) {
      const [width, height] = options.viewport.split('x').map(Number);
      config.browser.viewport = { width, height };
    }
    if (options.noScreenshots) config.capture.screenshots.enabled = false;
    if (options.noNetwork) config.capture.network.enabled = false;

    // Mode selection
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

    // Resolve URL — accept both bare hostnames and full URLs
    let finalStartUrl: string | undefined;
    const rawUrl = options.url || startUrl;

    if (rawUrl) {
      finalStartUrl = normalizeUrl(rawUrl);
      if (!isValidUrl(finalStartUrl)) {
        throw new Error(`Invalid URL: ${rawUrl}`);
      }
    } else {
      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'url',
          message: 'Enter starting URL:',
          validate: (input: string) => {
            if (!input.trim()) return 'URL is required';
            const normalised = normalizeUrl(input.trim());
            return isValidUrl(normalised) ||
              'Please enter a valid URL — e.g. saucedemo.com or https://example.com';
          },
        },
      ]);
      finalStartUrl = normalizeUrl(answers.url.trim());
    }

    const spinner = ora('Initializing ContextGraph...').start();
    const runtime = new RuntimeController(config, mode);
    await runtime.initialize();

    /**
     * Shared shutdown handler.
     * Called when: browser window closed, Ctrl+C pressed, SIGTERM received.
     * Saves data, generates AI bundle + API inventory, then exits.
     */
    let isShuttingDown = false;
    const shutdown = async (triggeredByBrowserClose = false) => {
      if (isShuttingDown) return;
      isShuttingDown = true;

      if (triggeredByBrowserClose) {
        console.log('\n' + chalk.yellow('Browser closed — saving captured data...'));
      } else {
        console.log('\n' + chalk.yellow('Shutting down gracefully...'));
      }

      // 1. Wait for any in-flight captures to complete
      try {
        await runtime.shutdown();
        console.log(chalk.green('✓ Page data saved'));
      } catch (err) {
        console.error(chalk.red(`Shutdown error: ${(err as Error).message}`));
      }

      // 2. Auto-generate AI context bundle (single-file LLM export)
      try {
        const { AIContextBundler } = await import('../exporters/ai-context-bundler');
        const bundler = new AIContextBundler(config.storage.outputDir);
        const bundlePath = await bundler.bundle();
        console.log(chalk.green(`✓ AI context bundle:  ${bundlePath}`));
      } catch (bundleErr) {
        // Non-fatal — may fail on very short sessions with no captured pages
        logger.warn(`AI bundle skipped: ${(bundleErr as Error).message}`);
      }

      // 3. Auto-generate API inventory from captured network traffic
      try {
        const { NetworkPatternAnalyzer } = await import('../analyzers/network-patterns');
        const analyzer = new NetworkPatternAnalyzer(config.storage.outputDir);
        const inventoryPath = await analyzer.analyze();
        console.log(chalk.green(`✓ API inventory:      ${inventoryPath}`));
      } catch (inventoryErr) {
        logger.warn(`API inventory skipped: ${(inventoryErr as Error).message}`);
      }

      console.log(chalk.blue(`\nOutput: ${config.storage.outputDir}`));

      setTimeout(() => process.exit(0), 200);
    };

    // Recorder mode
    if (mode === RuntimeMode.RECORDER) {
      spinner.succeed('Runtime initialized');
      await runtime.startRecorder(finalStartUrl, { captureArtifacts: Boolean(options.recorderCapture) });
      await shutdown();
      return;
    }

    // Browser mode
    spinner.text = 'Launching browser...';
    const browser = await runtime.launchBrowser();
    const context = await runtime.createContext(browser);

    spinner.text = 'Setting up page...';
    const page = await context.newPage();
    await runtime.setupPage(page);

    spinner.text = `Navigating to ${finalStartUrl}...`;
    try {
      await page.goto(finalStartUrl, { waitUntil: 'domcontentloaded' });
      spinner.succeed(`Navigated to ${finalStartUrl}`);
      await new Promise(r => setTimeout(r, 1000));
      await runtime.capturePageIfNeeded(page);
    } catch (error) {
      spinner.fail(`Failed to navigate to ${finalStartUrl}`);
      throw error;
    }

    console.log(chalk.green('\n✓ Browser ready!'));
    console.log(chalk.blue('Navigate freely — every page you visit is captured automatically.'));
    console.log(chalk.yellow('Close the browser window (or press Ctrl+C) when done.\n'));

    // Browser close → auto-exit
    runtime.onBrowserDisconnect(async () => {
      await shutdown(true);
    });

    // Ctrl+C / kill signal → auto-exit
    process.on('SIGINT', async () => { await shutdown(false); });
    process.on('SIGTERM', async () => { await shutdown(false); });

  } catch (error) {
    const err = error as Error;
    console.error(chalk.red(`Error: ${err.message}`));
    if (options.verbose) console.error(err.stack);
    process.exit(1);
  }
});

program.parse();
