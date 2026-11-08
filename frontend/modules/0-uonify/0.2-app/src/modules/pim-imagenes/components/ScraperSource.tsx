import { useId, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { PimProduct, PimScope } from '@/shared/pim';
import { Icon, Progress } from '@/shared/ui';
import { handleGenerateAIImages } from '../actions/generate';
import { handleImageScraping } from '../actions/scraping';
import { useFocusKeeper } from '../hooks/useFocusKeeper';
import { useImagesMemory } from '../hooks/useImagesMemory';
import { setImageUrl } from '../state/memory';

/**
 * «Extraer Imágenes desde URL» con «Generar Imágenes» (IA) debajo (prototipo:
 * scraperHTML y generateHTML). La sección se marca ocupada mientras extrae.
 */
export function ScraperSource({ scope, product }: { scope: PimScope; product: PimProduct | null }) {
  const titleId = useId();
  const urlId = useId();
  const regionRef = useRef<HTMLElement>(null);
  const { imageUrl, scraping, isGeneratingAI } = useImagesMemory(useShallow(state => ({
    imageUrl: state.imageUrl,
    scraping: state.scraping,
    isGeneratingAI: state.isGeneratingAI,
  })));
  useFocusKeeper(regionRef, '[data-focus="url"]');
  const pct = scraping ? Math.round(scraping.progress) : 0;
  const busy = Boolean(scraping);

  return (
    <section
      ref={regionRef}
      className="pim-imagenes-source pim-imagenes-scraper"
      data-region="scraper"
      tabIndex={-1}
      aria-labelledby={titleId}
      aria-busy={busy}
    >
      <h3 id={titleId} className="pim-section-title">
        <Icon name="globe" size={16} />
        Extraer Imágenes desde URL
      </h3>
      <div className="pim-field">
        <label className="pim-label" htmlFor={urlId}>URL del Producto</label>
        <div className="pim-imagenes-url-row">
          <input
            id={urlId}
            className="pim-input pim-mono"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            data-focus="url"
            value={imageUrl}
            placeholder="https://ejemplo.com/producto"
            disabled={busy}
            onChange={event => setImageUrl(event.target.value)}
          />
          <button
            type="button"
            className="pim-btn pim-btn-outline pim-btn-icon pim-imagenes-scan"
            data-focus="scrape"
            aria-label="Extraer Imágenes desde URL"
            data-tooltip="Extraer Imágenes desde URL"
            data-tooltip-align="end"
            disabled={busy || !imageUrl}
            aria-busy={busy || undefined}
            onClick={() => handleImageScraping(scope, Boolean(product))}
          >
            {busy ? <Icon name="refresh-cw" size={16} className="pim-spin" /> : <Icon name="scan" size={16} />}
          </button>
        </div>
      </div>
      {scraping ? (
        <div className="pim-imagenes-progress">
          <div className="pim-imagenes-progress-head">
            <Icon name="scan" size={14} />
            <strong role="status">Extrayendo imágenes...</strong>
            <span className="pim-imagenes-pct pim-mono">{pct}%</span>
          </div>
          <Progress value={pct} label="Extrayendo imágenes..." />
        </div>
      ) : null}
      <div className="pim-imagenes-generate">
        <button
          type="button"
          className="pim-btn pim-btn-ai"
          data-focus="generate"
          disabled={isGeneratingAI}
          aria-busy={isGeneratingAI || undefined}
          onClick={() => void handleGenerateAIImages(scope, product)}
        >
          {isGeneratingAI ? <Icon name="refresh-cw" size={16} className="pim-spin" /> : <Icon name="uony" size={16} />}
          {isGeneratingAI ? 'Generando...' : 'Generar Imágenes'}
        </button>
      </div>
    </section>
  );
}
