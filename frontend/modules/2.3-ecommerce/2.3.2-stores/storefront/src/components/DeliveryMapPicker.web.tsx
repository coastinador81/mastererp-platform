import { Ionicons } from '@expo/vector-icons';
import { createElement, type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing } from '../theme';

type Props = {
  latitude: string;
  longitude: string;
  onChange: (latitude: string, longitude: string) => void;
  onAddressChange: (address: string) => void;
};

const CARACAS = { latitude: 10.4806, longitude: -66.9036 };

export function DeliveryMapPicker({ latitude, longitude, onChange, onAddressChange }: Props) {
  const iframe = useRef<HTMLIFrameElement | null>(null);
  const request = useRef(0);
  const [message, setMessage] = useState('');
  const [locating, setLocating] = useState(false);
  const coordinate = useMemo(() => {
    const lat = Number(latitude), lng = Number(longitude);
    return latitude && longitude && Number.isFinite(lat) && Number.isFinite(lng)
      ? { latitude: lat, longitude: lng }
      : CARACAS;
  }, [latitude, longitude]);

  useEffect(() => {
    iframe.current?.contentWindow?.postMessage({ type: 'mastererp-set-map-point', ...coordinate }, '*');
  }, [coordinate]);

  const setPoint = useCallback(async (lat: number, lng: number) => {
    onChange(lat.toFixed(7), lng.toFixed(7));
    const current = ++request.current;
    setMessage('Buscando la dirección del punto seleccionado…');
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&accept-language=es&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}`);
      if (!response.ok) throw new Error('Reverse geocoding failed');
      const result = await response.json() as { display_name?: string };
      if (current !== request.current) return;
      if (result.display_name?.trim()) {
        onAddressChange(result.display_name.trim());
        setMessage('');
      } else setMessage('No encontramos una dirección exacta. Puedes escribirla manualmente.');
    } catch {
      if (current === request.current) setMessage('No pudimos identificar la dirección. Puedes escribirla manualmente.');
    }
  }, [onAddressChange, onChange]);

  useEffect(() => {
    const receivePoint = (event: MessageEvent) => {
      if (event.source !== iframe.current?.contentWindow || event.data?.type !== 'mastererp-map-point') return;
      const lat = Number(event.data.latitude), lng = Number(event.data.longitude);
      if (Number.isFinite(lat) && Number.isFinite(lng)) void setPoint(lat, lng);
    };
    window.addEventListener('message', receivePoint);
    return () => window.removeEventListener('message', receivePoint);
  }, [setPoint]);

  const useCurrentLocation = () => {
    if (!navigator.geolocation) return setMessage('Tu navegador no permite obtener la ubicación.');
    setLocating(true);
    setMessage('Obteniendo tu ubicación…');
    navigator.geolocation.getCurrentPosition(
      position => void setPoint(position.coords.latitude, position.coords.longitude).finally(() => setLocating(false)),
      () => { setLocating(false); setMessage('No pudimos obtener tu ubicación. Revisa el permiso del navegador.'); },
      { enableHighAccuracy: true, timeout: 12000 },
    );
  };

  return <View style={styles.wrapper}>
    {createElement('iframe', { ref: iframe, title: 'Punto de entrega', srcDoc: mapHtml(coordinate.latitude, coordinate.longitude), style: iframeStyle, sandbox: 'allow-scripts allow-same-origin' })}
    <Pressable style={[styles.locationButton, locating && styles.disabled]} onPress={useCurrentLocation} disabled={locating} accessibilityRole="button">
      <Ionicons name="locate-outline" size={20} color={colors.primaryDark} />
      <Text style={styles.locationText}>{locating ? 'Ubicando…' : 'Usar mi ubicación'}</Text>
    </Pressable>
    <Text style={styles.hint}>Toca el mapa o arrastra el pin hasta la entrada.</Text>
    {message ? <Text style={styles.message} accessibilityLiveRegion="polite">{message}</Text> : null}
  </View>;
}

function mapHtml(latitude: number, longitude: number) {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"><style>html,body,#map{height:100%;margin:0;background:#eef2f0}.leaflet-control-attribution{font-size:9px}.pin{width:34px;height:34px;border-radius:50% 50% 50% 0;background:#159a83;border:4px solid white;box-shadow:0 2px 8px #0005;transform:rotate(-45deg)}</style></head><body><div id="map"></div><script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script><script>const map=L.map('map').setView([${latitude},${longitude}],17);L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap'}).addTo(map);const icon=L.divIcon({className:'',html:'<div class="pin"></div>',iconSize:[42,42],iconAnchor:[17,38]});const marker=L.marker([${latitude},${longitude}],{draggable:true,icon}).addTo(map);function send(point){marker.setLatLng(point);parent.postMessage({type:'mastererp-map-point',latitude:point.lat,longitude:point.lng},'*')}addEventListener('message',event=>{if(event.data?.type!=='mastererp-set-map-point')return;const next=L.latLng(event.data.latitude,event.data.longitude);marker.setLatLng(next);map.panTo(next)});map.on('click',event=>send(event.latlng));marker.on('dragend',()=>send(marker.getLatLng()));</script></body></html>`;
}

const iframeStyle: CSSProperties = { width: '100%', height: 240, border: 0, borderRadius: radii.md };
const styles = StyleSheet.create({
  wrapper: { gap: spacing.sm },
  locationButton: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: colors.primary, borderRadius: radii.md, backgroundColor: colors.surface },
  locationText: { color: colors.primaryDark, fontSize: 13, fontWeight: '800' },
  hint: { color: colors.muted, fontSize: 11, textAlign: 'center' },
  message: { color: colors.text, fontSize: 11, lineHeight: 17, textAlign: 'center' },
  disabled: { opacity: 0.6 },
});
