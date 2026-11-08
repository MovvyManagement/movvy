'use client';

import { useEffect, useRef, useState } from 'react';

declare global {
  interface Window {
    google?: any;
    __movvyMapsReady?: () => void;
  }
}

const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY ?? '';
let mapsLoading: Promise<void> | null = null;

function loadMaps(): Promise<void> {
  if (window.google?.maps?.Map) return Promise.resolve();
  if (mapsLoading) return mapsLoading;
  mapsLoading = new Promise((resolve, reject) => {
    window.__movvyMapsReady = () => resolve();
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(MAPS_KEY)}&v=weekly&loading=async&callback=__movvyMapsReady`;
    script.async = true;
    script.onerror = () => {
      mapsLoading = null;
      reject(new Error('Map failed to load'));
    };
    document.head.appendChild(script);
  });
  return mapsLoading;
}

interface Point {
  lat: number;
  lng: number;
}

const dot = (fill: string, label: string) => ({
  url:
    'data:image/svg+xml;charset=UTF-8,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34"><circle cx="17" cy="17" r="15" fill="${fill}" stroke="#fff" stroke-width="3"/><text x="17" y="22" font-family="Arial" font-size="14" font-weight="700" fill="#fff" text-anchor="middle">${label}</text></svg>`,
    ),
});

const truck = () => ({
  url:
    'data:image/svg+xml;charset=UTF-8,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><circle cx="24" cy="24" r="21" fill="#0A7A3E" stroke="#fff" stroke-width="3"/><path d="M12 17h15v13H12zM27 21h5l4 4v5h-9z" fill="#fff"/><circle cx="18" cy="31" r="2.6" fill="#0A0A0A"/><circle cx="31" cy="31" r="2.6" fill="#0A0A0A"/></svg>`,
    ),
});

export function LiveMap({
  pickup,
  dropoff,
  crew,
  target,
}: {
  pickup: Point | null;
  dropoff: Point | null;
  crew: Point | null;
  target: Point | null;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const pins = useRef<{ pickup?: any; dropoff?: any; crew?: any; line?: any }>({});
  const framed = useRef('');
  const [failed, setFailed] = useState(!MAPS_KEY);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!MAPS_KEY) return;
    let cancelled = false;
    loadMaps()
      .then(() => {
        if (cancelled || !container.current || map.current) return;
        map.current = new window.google.maps.Map(container.current, {
          center: pickup ?? { lat: 51.0447, lng: -114.0719 },
          zoom: 11,
          disableDefaultUI: true,
          zoomControl: true,
          clickableIcons: false,
          gestureHandling: 'cooperative',
        });
        setReady(true);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
    // The map is created once. Pins are updated by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ready || !map.current) return;
    const { Marker, Polyline, LatLngBounds } = window.google.maps;
    const place = (key: 'pickup' | 'dropoff' | 'crew', point: Point | null, icon: unknown, title: string, z: number) => {
      const existing = pins.current[key];
      if (!point) {
        existing?.setMap(null);
        pins.current[key] = undefined;
      } else if (existing) {
        existing.setPosition(point);
      } else {
        pins.current[key] = new Marker({ map: map.current, position: point, icon, title, zIndex: z });
      }
    };
    place('pickup', pickup, dot('#0A0A0A', 'A'), 'Pickup', 1);
    place('dropoff', dropoff, dot('#71717A', 'B'), 'Drop-off', 1);
    place('crew', crew, truck(), 'Your crew', 10);

    pins.current.line?.setMap(null);
    pins.current.line = undefined;
    const from = crew;
    const to = target;
    if (from && to) {
      pins.current.line = new Polyline({
        map: map.current,
        path: [from, to],
        strokeOpacity: 0,
        icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, strokeColor: '#0A7A3E', scale: 3 }, offset: '0', repeat: '14px' }],
      });
    }

    // Reframe only when the points in play change, so the view doesn't jump
    // under someone's fingers every five seconds as the truck moves.
    const points = [crew, target ?? pickup, target ? null : dropoff].filter(Boolean) as Point[];
    const signature = `${crew ? 'c' : ''}|${target ? `${target.lat},${target.lng}` : ''}`;
    if (points.length && framed.current !== signature) {
      framed.current = signature;
      if (points.length === 1) {
        map.current.setCenter(points[0]);
        map.current.setZoom(14);
      } else {
        const bounds = new LatLngBounds();
        points.forEach((p) => bounds.extend(p));
        map.current.fitBounds(bounds, 56);
      }
    }
  }, [ready, pickup, dropoff, crew, target]);

  if (failed) {
    return (
      <div className="flex h-[300px] items-center justify-center rounded-3xl bg-silver-100 px-6 text-center text-sm text-silver-600 lg:h-[440px]">
        The map isn&apos;t available right now. Your move&apos;s status on this page is still live.
      </div>
    );
  }
  return <div ref={container} className="h-[300px] w-full overflow-hidden rounded-3xl bg-silver-100 lg:h-[440px]" />;
}
