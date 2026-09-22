/** Default tool: does nothing yet beyond the hover highlight (inspection comes later). */

import type { Tool } from './tool';

export class SelectTool implements Tool {
  readonly id = 'select' as const;
  readonly cursor = 'default';
  activate(): void {}
  deactivate(): void {}
  pointerDown(): void {}
  pointerUp(): void {}
  hover(): void {}
  cancel(): boolean {
    return false;
  }
}
