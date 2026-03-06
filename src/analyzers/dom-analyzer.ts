// Developer: Shadow Coderr, Architect
import { Page, Frame } from '@playwright/test';

export class DOMAnalyzer {
  

  private async serializeFrameContent(frame: Frame): Promise<string> {
    try {
      return await frame.evaluate(() => {
        const serialize = (node: any): string => {
          if (!node) return '';
          const nodeType = node.nodeType;
          const Node = window.Node;
          if (nodeType === Node.DOCUMENT_NODE) return '<!DOCTYPE html>' + serialize(node.documentElement);
          if (nodeType === Node.ELEMENT_NODE) {
            const el = node as Element;
            let tag = el.tagName.toLowerCase();
            let attrs = '';
            for (let i = 0; i < el.attributes.length; i++) {
              const a = el.attributes[i];
              attrs += ` ${a.name}="${a.value}"`;
            }
            let inner = '';
            // Shadow DOM
            if ((el as any).shadowRoot) {
              inner += '<!--cc-shadow-start-->';
              const sr = (el as any).shadowRoot;
              for (let i = 0; i < sr.childNodes.length; i++) {
                inner += serialize(sr.childNodes[i]);
              }
              inner += '<!--cc-shadow-end-->';
            }
            for (let i = 0; i < el.childNodes.length; i++) {
              inner += serialize(el.childNodes[i]);
            }
            return `<${tag}${attrs}>${inner}</${tag}>`;
          }
          if (nodeType === Node.TEXT_NODE) return node.nodeValue.replace(/</g, '&lt;');
          return '';
        };
        return serialize(document);
      });
    } catch (error) {
      return '';
    }
  }

  async analyze(page: Page): Promise<{ html: string; frames: Array<{ url: string; name: string; content: string }> }> {
    // Get the main document serialized including shadow roots
    const html = await page.evaluate(() => {
      const serialize = (node: any): string => {
        if (!node) return '';
        const nodeType = node.nodeType;
        const Node = window.Node;
        if (nodeType === Node.DOCUMENT_NODE) return '<!DOCTYPE html>' + serialize(node.documentElement);
        if (nodeType === Node.ELEMENT_NODE) {
          const el = node as Element;
          let tag = el.tagName.toLowerCase();
          let attrs = '';
          for (let i = 0; i < el.attributes.length; i++) {
            const a = el.attributes[i];
            attrs += ` ${a.name}="${a.value}"`;
          }
          let inner = '';
          // Shadow DOM
          if ((el as any).shadowRoot) {
            inner += '<!--cc-shadow-start-->';
            const sr = (el as any).shadowRoot;
            for (let i = 0; i < sr.childNodes.length; i++) {
              inner += serialize(sr.childNodes[i]);
            }
            inner += '<!--cc-shadow-end-->';
          }
          for (let i = 0; i < el.childNodes.length; i++) {
            inner += serialize(el.childNodes[i]);
          }
          return `<${tag}${attrs}>${inner}</${tag}>`;
        }
        if (nodeType === Node.TEXT_NODE) return node.nodeValue ? node.nodeValue.replace(/</g, '&lt;') : '';
        return '';
      };
      return serialize(document);
    });

    // Gather frames content
    const frames = [] as Array<{ url: string; name: string; content: string }>;
    const framesList = page.frames();
    for (let i = 0; i < framesList.length; i++) {
      const frame = framesList[i];
      if (frame === page.mainFrame()) continue; // Skip main frame
      const content = await this.serializeFrameContent(frame);
      frames.push({ url: frame.url(), name: frame.name(), content });
    }

    // Remove script tags and inline JavaScript from main html
    let sanitized = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    sanitized = sanitized.replace(/<script[^>]*\/\>/gi, '');
    sanitized = sanitized.replace(/\s+on\w+="[^"]*"/gi, '');
    sanitized = sanitized.replace(/\s+on\w+='[^']*'/gi, '');

    // Add capture timestamp
    const timestamp = new Date().toISOString();
    sanitized = sanitized.replace(/<html([^>]*)>/, `<html$1 data-cc-captured="${timestamp}">`);

    return { html: sanitized, frames };
  }

  async getPerformanceMetrics(page: Page): Promise<{
    domNodes: number;
    scripts: number;
    stylesheets: number;
    images: number;
    totalRequests: number;
  }> {
    const metrics = await page.evaluate(() => {
      const domNodes = document.getElementsByTagName('*').length;
      const scripts = document.querySelectorAll('script').length;
      const stylesheets = document.querySelectorAll('link[rel="stylesheet"]').length;
      const images = document.querySelectorAll('img').length;

      return {
        domNodes,
        scripts,
        stylesheets,
        images,
        totalRequests: 0, // Will be calculated from network events
      };
    });

    return metrics;
  }
}
