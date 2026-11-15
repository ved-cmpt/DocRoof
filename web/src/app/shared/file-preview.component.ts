import {
  Component,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../core/api.service';
import { Revision } from '../core/api.models';
import { problemMessage } from '../core/http';

interface PdfPageProxy {
  getViewport(o: { scale: number }): { width: number; height: number };
  render(o: {
    canvasContext: CanvasRenderingContext2D;
    viewport: unknown;
    canvas: HTMLCanvasElement;
  }): {
    promise: Promise<void>;
    cancel(): void;
  };
}

interface PdfDocProxy {
  numPages: number;
  getPage(n: number): Promise<PdfPageProxy>;
}

/** pdf.js loading task: owns the worker-side document and is what must be destroyed. */
interface PdfLoadingTask {
  promise: Promise<unknown>;
  destroy(): Promise<void>;
}

/**
 * Safe in-app preview. PDFs are rendered to a canvas by pdf.js with scripting and eval disabled (the document's own
 * JavaScript never runs); TXT is shown as escaped text; images use a blob URL. The server refuses previews of PDFs
 * flagged with active content.
 */
@Component({
  selector: 'app-file-preview',
  imports: [MatButtonModule],
  template: `
    <div class="preview" [attr.aria-busy]="loading()">
      @if (!revision().previewSupported) {
        <div class="notice" role="note">
          @if (revision().hasActiveContent) {
            This PDF contains active content (scripts, launch actions or embedded files). It is
            available as a download only.
          } @else {
            Preview is not available for this file type. Use Download.
          }
        </div>
      } @else if (error()) {
        <div class="error-box" role="alert">{{ error() }}</div>
      } @else {
        @if (kind() === 'pdf') {
          <div class="toolbar row" role="toolbar" aria-label="Page navigation">
            <button mat-stroked-button (click)="go(page() - 1)" [disabled]="page() <= 1">
              Previous
            </button>
            <label class="page-input">
              Page
              <input
                type="number"
                min="1"
                [max]="pages()"
                [value]="page()"
                (change)="go(+$any($event.target).value)"
                aria-label="Page number"
              />
              of {{ pages() }}
            </label>
            <button mat-stroked-button (click)="go(page() + 1)" [disabled]="page() >= pages()">
              Next
            </button>
            @if (!revision().hasTextLayer) {
              <span class="chip warn plain">No text layer</span>
            }
          </div>
          <div class="canvas-wrap">
            <canvas
              #canvas
              role="img"
              [attr.aria-label]="'Page ' + page() + ' of ' + revision().fileName"
            ></canvas>
          </div>
        } @else if (kind() === 'text') {
          <pre class="text-preview" tabindex="0" aria-label="Text content">{{ text() }}</pre>
        } @else if (kind() === 'image') {
          <img
            [src]="imageUrl()"
            [alt]="'Image revision ' + revision().versionLabel + ': ' + revision().fileName"
          />
        }
        @if (loading()) {
          <p class="muted small" role="status">Loading preview…</p>
        }
      }
    </div>
  `,
  styles: `
    .preview {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .toolbar {
      gap: 8px;
    }
    .page-input input {
      width: 56px;
      margin: 0 4px;
      padding: 4px;
      font: inherit;
      border: 1px solid var(--line-strong);
      border-radius: 4px;
    }
    .canvas-wrap {
      background: var(--concrete-2);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: 12px;
      overflow: auto;
      max-height: 78vh;
      text-align: center;
    }
    canvas {
      max-width: 100%;
      height: auto;
      box-shadow: var(--shadow-2);
      background: #fff;
    }
    .text-preview {
      white-space: pre-wrap;
      word-break: break-word;
      font-family: var(--font-mono);
      font-size: 0.85rem;
      background: #fbfbfa;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: 16px;
      max-height: 70vh;
      overflow: auto;
      margin: 0;
    }
    img {
      max-width: 100%;
      border: 1px solid var(--line);
    }
  `,
})
export class FilePreviewComponent {
  private readonly api = inject(ApiService);
  private readonly destroyRef = inject(DestroyRef);

  readonly revision = input.required<Revision>();
  readonly requestedPage = input<number | null>(null);
  readonly pageChange = output<number>();

  private readonly canvas = viewChild<ElementRef<HTMLCanvasElement>>('canvas');
  protected readonly kind = signal<'pdf' | 'text' | 'image' | 'none'>('none');
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly text = signal('');
  protected readonly imageUrl = signal('');
  protected readonly page = signal(1);
  protected readonly pages = signal(1);
  private doc: PdfDocProxy | null = null;
  private loadingTask: PdfLoadingTask | null = null;
  private renderTask: { cancel(): void } | null = null;
  private loadToken = 0;

  constructor() {
    effect(() => {
      const rev = this.revision();
      untracked(() => void this.load(rev));
    });
    effect(() => {
      const p = this.requestedPage();
      if (p) {
        untracked(() => this.go(p));
      }
    });
    effect(() => {
      // Re-render whenever the canvas appears or the page changes.
      const el = this.canvas();
      const p = this.page();
      if (el && this.doc) {
        untracked(() => void this.render(p));
      }
    });
    this.destroyRef.onDestroy(() => this.cleanup());
  }

  protected go(n: number): void {
    if (!Number.isFinite(n)) {
      return;
    }
    const clamped = Math.min(Math.max(1, Math.round(n)), this.pages());
    if (clamped !== this.page()) {
      this.page.set(clamped);
      this.pageChange.emit(clamped);
    }
  }

  private cleanup(): void {
    this.renderTask?.cancel();
    const task = this.loadingTask;
    this.loadingTask = null;
    this.doc = null;
    task?.destroy().catch(() => undefined);
    if (this.imageUrl()) {
      URL.revokeObjectURL(this.imageUrl());
      this.imageUrl.set('');
    }
  }

  private async load(rev: Revision): Promise<void> {
    const token = ++this.loadToken;
    this.cleanup();
    this.error.set('');
    this.kind.set('none');
    if (!rev.previewSupported) {
      return;
    }
    this.loading.set(true);
    try {
      const blob = await firstValueFrom(this.api.previewBlob(rev.id));
      if (token !== this.loadToken) {
        return;
      }
      if (rev.mimeType === 'application/pdf') {
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
        const data = new Uint8Array(await blob.arrayBuffer());
        const task = pdfjs.getDocument({ data, enableXfa: false }) as unknown as PdfLoadingTask;
        const doc = (await task.promise) as PdfDocProxy;
        if (token !== this.loadToken) {
          task.destroy().catch(() => undefined);
          return;
        }
        this.loadingTask = task;
        this.doc = doc;
        this.pages.set(doc.numPages);
        const wanted = this.requestedPage();
        this.page.set(wanted && wanted <= doc.numPages ? wanted : 1);
        this.kind.set('pdf');
        const el = this.canvas();
        if (el) {
          await this.render(this.page());
        }
      } else if (rev.mimeType === 'text/plain') {
        this.text.set(await blob.text());
        this.kind.set('text');
      } else {
        this.imageUrl.set(URL.createObjectURL(blob));
        this.kind.set('image');
      }
    } catch (e) {
      if (token === this.loadToken) {
        this.error.set(problemMessage(e, 'The preview could not be loaded.'));
      }
    } finally {
      if (token === this.loadToken) {
        this.loading.set(false);
      }
    }
  }

  private async render(pageNumber: number): Promise<void> {
    const el = this.canvas()?.nativeElement;
    if (!this.doc || !el) {
      return;
    }
    this.renderTask?.cancel();
    const page = await this.doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1.5 });
    el.width = viewport.width;
    el.height = viewport.height;
    const ctx = el.getContext('2d');
    if (!ctx) {
      return;
    }
    const task = page.render({ canvasContext: ctx, viewport, canvas: el });
    this.renderTask = task;
    try {
      await task.promise;
    } catch {
      /* cancelled by a newer render */
    }
  }
}
