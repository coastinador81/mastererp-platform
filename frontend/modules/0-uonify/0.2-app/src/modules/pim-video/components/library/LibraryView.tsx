import { useCallback, useId, useRef, useState, type RefObject } from 'react';
import { useTabContext } from '@/shared/pim';
import { VIDEO_ACCEPT } from '../../model/constants';
import { useDetection } from '../../hooks/useJobs';
import { useLibraryActions } from '../../hooks/useLibraryActions';
import type { LibraryApi } from '../../hooks/useVideoData';
import type { ProductView } from '../../hooks/useProductData';
import { ChecksSection } from './ChecksSection';
import { DetailsSection } from './DetailsSection';
import { EmptyLibrary } from './EmptyLibrary';
import { LibraryFooter } from './LibraryFooter';
import { ScenesSection, activeScene } from './ScenesSection';
import { VideoList } from './VideoList';
import { VideoStage } from './VideoStage';

/**
 * «Vídeos del producto» (prototipo: pim/video.js, biblioteca): reproductor, escenas,
 * detalles, requisitos de Amazon, lista de vídeos y pie con la acción del destino.
 */
interface LibraryViewProps {
  root: RefObject<HTMLElement | null>;
  library: LibraryApi;
  productView: ProductView;
  onCreate: () => void;
}

export function LibraryView({ root, library, productView, onCreate }: LibraryViewProps) {
  const { key } = useTabContext();
  const base = useId();
  const ids = {
    scenes: `${base}-scenes`, details: `${base}-details`, checks: `${base}-checks`, list: `${base}-list`,
    title: `${base}-title`, language: `${base}-language`, destination: `${base}-destination`,
  };
  const player = useRef<HTMLVideoElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const [time, setTime] = useState(0);
  const detection = useDetection(key);
  const actions = useLibraryActions({ root, player, library, productView, checksHeadingId: ids.checks });
  const video = library.current;
  const active = activeScene(video?.chapters, time);

  const upload = useCallback(() => videoInput.current?.click(), []);
  const onSeek = useCallback((at: number) => {
    const element = player.current;
    if (!element) return;
    element.currentTime = at;
    element.play().catch(() => {});
    setTime(at);
  }, []);
  const onSelect = useCallback((id: string) => {
    setTime(0);
    library.select(id);
  }, [library]);

  const input = (
    <input
      ref={videoInput}
      type="file"
      accept={VIDEO_ACCEPT}
      hidden
      onChange={event => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = '';
        void actions.addVideo(file);
      }}
    />
  );

  if (!video) {
    return (
      <>
        <EmptyLibrary onUpload={upload} onCreate={onCreate} onDropFile={file => void actions.addVideo(file)} />
        {input}
      </>
    );
  }

  return (
    <>
      <VideoStage video={video} player={player} onDownload={actions.download} onMetadata={library.patchVideo} onTime={setTime} />
      <ScenesSection
        video={video}
        headingId={ids.scenes}
        detection={detection}
        activeIndex={active}
        onDetect={() => void actions.runDetection()}
        onSeek={onSeek}
      />
      <DetailsSection
        video={video}
        ids={ids}
        onPatch={patch => library.patchVideo(video.id, patch)}
        onPosterFrame={actions.posterFromFrame}
        onPosterFile={file => void actions.posterFromFile(file)}
      />
      <ChecksSection video={video} asin={productView.asin} headingId={ids.checks} />
      <VideoList
        videos={library.videos}
        selectedId={library.selectedId}
        headingId={ids.list}
        onSelect={onSelect}
        onDelete={id => void actions.deleteVideo(id)}
        onUpload={upload}
        onDropFile={file => void actions.addVideo(file)}
      />
      <LibraryFooter video={video} onSellerCentral={actions.openSellerCentral} onAds={actions.adsAction} />
      {input}
    </>
  );
}
