import { useEffect, useRef, type Ref } from 'react';
import { flushSync } from 'react-dom';
import clsx from 'clsx';
import { useChannels, type Channel } from '@/shared/pim';
import { InformationDisclosure } from '@/shared/ui';
import type { CatalogProduct } from '../model/types';
import { channelStatesOf, useCatalogStore } from '../hooks/useCatalogStore';
import { ChevronIcon } from './ProductIcon';

export interface ChannelBarProps {
  /** Producto guardado de la ficha abierta (null en «Nuevo Producto» o sin ficha). */
  product: CatalogProduct | null;
  /** Hay ficha abierta: los canales son interruptores; sin ficha, conectores. */
  hasSheet: boolean;
  /** «Conectar cuenta de …» lleva a Nexus. */
  onConnect: (channel: string) => void;
}

const isConnected = (channel: Channel) => typeof channel.connected === 'function' && channel.connected();

/**
 * Canales de venta en el centro de la cabecera (prototipo: renderChannelBar). Sin
 * ficha acompañan a Producto como conectores (estado de la conexión y «Conectar»);
 * con un producto, son su interruptor para publicar ahí. Hoy solo Amazon.
 */
export function ChannelBar({ product, hasSheet, onConnect }: ChannelBarProps) {
  const channels = useChannels();
  const channelStates = useCatalogStore(state => state.channelStates);
  const menuFor = useCatalogStore(state => state.channelMenuFor);
  const setChannelMenu = useCatalogStore(state => state.setChannelMenu);
  const setChannel = useCatalogStore(state => state.setChannel);
  const barRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLElement>(null);
  const connector = !hasSheet;
  const states = channelStatesOf(channelStates, product?.sku ?? null, channels.map(channel => channel.id));

  // Un clic fuera cierra el menú del canal.
  useEffect(() => {
    if (!menuFor) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (barRef.current?.contains(target) || menuRef.current?.contains(target))) return;
      setChannelMenu(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [menuFor, setChannelMenu]);

  // Al salir de Producto el menú no se queda abierto.
  useEffect(() => () => setChannelMenu(null), [setChannelMenu]);

  const openMenu = (name: string | null, focusMenu: boolean) => {
    flushSync(() => setChannelMenu(name));
    if (name && focusMenu) menuRef.current?.querySelector<HTMLElement>('button')?.focus();
  };

  const onToggle = (name: string) => {
    // Sin un producto guardado no hay nada que activar: se explica por qué.
    if (!product) {
      openMenu(name, true);
      return;
    }
    setChannel(product.sku, name, !states[name]);
  };

  const chevron = (name: string) => (
    <button
      type="button"
      className="channel-switch-more"
      data-channel-menu={name}
      aria-expanded={menuFor === name}
      aria-controls="channel-menu"
      aria-label={`Detalles de ${name}`}
      data-tooltip="Detalles"
      data-tooltip-pos="below"
      onClick={() => openMenu(menuFor === name ? null : name, menuFor !== name)}
    >
      <ChevronIcon />
    </button>
  );

  const menuChannel = menuFor ? channels.find(channel => channel.id === menuFor) ?? null : null;

  return (
    <>
      <div ref={barRef} className="channel-bar" role="group" aria-label={connector ? 'Canales de venta' : 'Canales de venta de este producto'}>
        {channels.map(channel => {
          const name = channel.id;
          if (connector) {
            return (
              <div key={name} className="channel-switch is-connector">
                <button
                  type="button"
                  className="channel-switch-main"
                  data-channel-menu={name}
                  aria-expanded={menuFor === name}
                  aria-controls="channel-menu"
                  aria-label={`${name}: conexión y publicación`}
                  data-tooltip={`${name} · ${isConnected(channel) ? 'conectada' : 'sin conectar'}`}
                  data-tooltip-pos="below"
                  onClick={() => openMenu(menuFor === name ? null : name, menuFor !== name)}
                >
                  {channel.logo ? <img src={channel.logo} width={64} height={19} alt="" /> : name}
                  <span className="channel-switch-link" aria-hidden="true" />
                </button>
                {chevron(name)}
              </div>
            );
          }
          const active = Boolean(product) && states[name] === true;
          const hint = !product
            ? `Guarda el producto para elegir si se publica en ${name}`
            : active
              ? `${name} activado para este producto. Pulsa para desactivarlo.`
              : `${name} desactivado para este producto. Pulsa para activarlo.`;
          return (
            <div key={name} className={clsx('channel-switch', active && 'is-active', !product && 'is-disabled')}>
              <button
                type="button"
                className="channel-switch-main"
                data-channel-toggle={name}
                aria-pressed={active}
                aria-disabled={product ? undefined : true}
                aria-label={`Publicar en ${name}`}
                data-tooltip={hint}
                data-tooltip-pos="below"
                onClick={() => onToggle(name)}
              >
                {channel.logo ? <img src={channel.logo} width={64} height={19} alt="" /> : name}
                <span className="channel-switch-state" aria-hidden="true" />
              </button>
              {chevron(name)}
            </div>
          );
        })}
      </div>
      {menuChannel ? (
        <ChannelMenu
          ref={menuRef}
          channel={menuChannel}
          connector={connector}
          hasProduct={Boolean(product)}
          active={Boolean(product) && states[menuChannel.id] === true}
          onConnect={() => {
            setChannelMenu(null);
            onConnect(menuChannel.id);
          }}
        />
      ) : null}
    </>
  );
}

interface ChannelMenuProps {
  ref: Ref<HTMLElement>;
  channel: Channel;
  connector: boolean;
  hasProduct: boolean;
  active: boolean;
  onConnect: () => void;
}

/** Menú de un canal (prototipo: renderChannelMenu). */
function ChannelMenu({ ref, channel, connector, hasProduct, active, onConnect }: ChannelMenuProps) {
  const name = channel.id;
  const status = connector
    ? `Conecta tu cuenta para publicar en ${name}. Después, en cada producto eliges si se publica aquí.`
    : !hasProduct
      ? 'Guarda el producto para elegir si se publica aquí.'
      : active
        ? 'Activado para este producto.'
        : 'Desactivado para este producto.';
  return (
    <section ref={ref} className="channel-menu" id="channel-menu" aria-label={`Publicación en ${name}`}>
      <div className="channel-menu-head">
        {channel.logo ? <img src={channel.logo} width={72} height={22} alt={name} /> : <strong>{name}</strong>}
        <span>{channel.market}</span>
      </div>
      <p className={clsx('channel-menu-status', active && 'is-active')}>{status}</p>
      <InformationDisclosure><p>Activar el canal no publica nada: antes verás cómo quedará el anuncio y confirmarás tú.</p></InformationDisclosure>
      <div className="channel-menu-row">
        <span>Cuenta de {name}</span>
        <strong>{isConnected(channel) ? 'Conectada' : 'Sin conectar'}</strong>
      </div>
      <button type="button" className="secondary-action" data-channel-connect={name} onClick={onConnect}>
        Conectar cuenta de {name}
      </button>
    </section>
  );
}
