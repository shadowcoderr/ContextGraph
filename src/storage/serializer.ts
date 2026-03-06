// Developer: Shadow Coderr, Architect
import { PageSnapshot } from '../types/capture';

export class DataSerializer {
  serializePageSnapshot(snapshot: PageSnapshot): string {
    return JSON.stringify(snapshot, null, 2);
  }

  deserializePageSnapshot(data: string): PageSnapshot {
    return JSON.parse(data);
  }

  serializeMetadata(metadata: any): string {
    return JSON.stringify(metadata, null, 2);
  }

  serializeLocators(locators: any): string {
    return JSON.stringify(locators, null, 2);
  }

  serializeAccessibilityTree(tree: any): string {
    return JSON.stringify(tree, null, 2);
  }
}
