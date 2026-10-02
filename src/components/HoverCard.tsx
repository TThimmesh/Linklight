import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { hoverStore, pointerStore, useStore } from '../lib/hooks';
import { farEnd, farEndLabel, linkSpan, portId, type Placement, type SiteIndex } from '../lib/site';
import { CABLE_HEX, POE_LABEL, modelLabel, type Link, type Rack } from '../lib/types';
import { HoverPhoto, StatusPill, useApp } from './ui';

export function HoverCard({ idx, placements, rack, links }: { idx: SiteIndex; placements: Placement[]; rack: Rack; links: Link[] }) {
  const hover = useStore(hoverStore);
  const pointer = useStore(pointerStore);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = pointer.x + 18;
    if (left + w > window.innerWidth - 8) left = pointer.x - w - 18;
    let top = pointer.y + 18;
    if (top + h > window.innerHeight - 8) top = Math.max(8, window.innerHeight - h - 8);
    setPos({ left, top });
  }, [pointer, hover]);

  if (!hover) return null;
  let body: ReactNode = null;
  if (hover.type === 'port') body = <PortCard idx={idx} deviceId={hover.deviceId} portKey={hover.key} />;
  else if (hover.type === 'device') body = <DeviceCard idx={idx} placements={placements} deviceId={hover.deviceId} />;
  else if (hover.type === 'link') body = <LinkCard idx={idx} link={links.find(l => l.id === hover.linkId)} />;
  else if (hover.type === 'slot') body = (
    <>
      <div className="hc-title">U{hover.u} · empty</div>
      <div className="hc-sub">{rack.name}</div>
      <div className="hc-foot">Click to add equipment here</div>
    </>
  );
  if (!body) return null;
  return <div ref={ref} className="hovercard" style={pos}>{body}</div>;
}

function PortCard({ idx, deviceId, portKey }: { idx: SiteIndex; deviceId: string; portKey: string }) {
  const { backend } = useApp();
  const device = idx.devicesById.get(deviceId);
  const spec = idx.portSpecs.get(deviceId)?.find(p => p.key === portKey);
  const conns = idx.connsByPort.get(portId(deviceId, portKey)) ?? [];
  const rec = idx.portRecords.get(portId(deviceId, portKey));
  if (!device) return null;
  const isPatch = device.type === 'patchpanel';
  const specLine = spec
    ? [spec.kind === 'rj45' ? 'RJ45' : spec.kind.toUpperCase(), spec.speed, spec.poe !== 'none' ? POE_LABEL[spec.poe] : ''].filter(Boolean).join(' · ')
    : '';

  return (
    <>
      <div className="hc-head">
        <div>
          <div className="hc-title">{device.name} · Port {portKey}</div>
          {specLine && <div className="hc-sub">{specLine}</div>}
        </div>
        {conns[0] && <StatusPill status={conns[0].link.status} />}
      </div>

      {conns.length === 0 && <div className="hc-conn none">Not connected</div>}
      {conns.map(c => {
        const fe = farEnd(idx, c);
        const lbl = farEndLabel(fe);
        const l = c.link;
        const span = linkSpan(idx, c);
        return (
          <div key={l.id}>
            <div className="hc-conn" style={{ borderLeftColor: l.poe && spec?.poe !== 'none' ? 'var(--poe-led)' : undefined }}>
              <div className="to">→ {lbl.title}</div>
              {lbl.port && <div className="hc-sub">{lbl.port}</div>}
            </div>
            <dl className="hc-rows">
              {(l.cableColor || l.cableLabel) && (
                <>
                  <dt>Cable</dt>
                  <dd style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {l.cableColor && <span className="swatch" style={{ background: CABLE_HEX[l.cableColor] ?? l.cableColor }} />}
                    {l.cableColor}{l.cableLabel && <span className="mono">“{l.cableLabel}”</span>}
                  </dd>
                </>
              )}
              {(l.speed || l.poe) && (
                <>
                  <dt>Link</dt>
                  <dd>{[l.speed, l.poe ? `PoE${l.poeWatts != null ? ` ${l.poeWatts} W` : ''}` : ''].filter(Boolean).join(' · ')}</dd>
                </>
              )}
              {fe.device?.ip && (<><dt>IP</dt><dd className="mono">{fe.device.ip}</dd></>)}
              {fe.device?.mac && (<><dt>MAC</dt><dd className="mono">{fe.device.mac}</dd></>)}
            </dl>
            {l.notes && <div className="hc-notes">{l.notes}</div>}
            {span.length > 1 && <div className="hc-foot">Documented for ports {span.join(', ')} together.</div>}
          </div>
        );
      })}
      {conns.length > 1 && <div className="warn">⚠ {conns.length} connections are documented on this port — one is probably wrong.</div>}

      {rec?.label && (
        <dl className="hc-rows"><dt>{isPatch ? 'Plate' : 'Label'}</dt><dd>{rec.label}</dd></dl>
      )}
      {rec?.notes && <div className="hc-notes">{rec.notes}</div>}
      {!!rec?.photos.length && (
        <div className="hc-photos">
          {rec.photos.slice(0, 3).map(p => <HoverPhoto key={p.path} backend={backend} path={p.path} />)}
        </div>
      )}
      <div className="hc-foot">Click to {conns.length ? 'edit' : 'document this port'}</div>
    </>
  );
}

function DeviceCard({ idx, placements, deviceId }: { idx: SiteIndex; placements: Placement[]; deviceId: string }) {
  const p = placements.find(x => x.device.id === deviceId);
  if (!p) return null;
  const specs = idx.portSpecs.get(deviceId) ?? [];
  const used = specs.filter(s => idx.connsByPort.has(portId(deviceId, s.key))).length;
  const uText = p.units > 1 ? `U${p.device.rackU}–U${p.device.rackU! + p.units - 1}` : `U${p.device.rackU}`;
  return (
    <>
      <div className="hc-head">
        <div>
          <div className="hc-title">{p.device.name}</div>
          <div className="hc-sub">{modelLabel(p.model)} · {uText}</div>
        </div>
        <StatusPill status={p.device.status} />
      </div>
      <dl className="hc-rows">
        {specs.length > 0 && (<><dt>Ports</dt><dd>{used} of {specs.length} in use</dd></>)}
        {p.device.ip && (<><dt>IP</dt><dd className="mono">{p.device.ip}</dd></>)}
        {p.device.mac && (<><dt>MAC</dt><dd className="mono">{p.device.mac}</dd></>)}
      </dl>
      {p.device.notes && <div className="hc-notes">{p.device.notes}</div>}
      <div className="hc-foot">Click to zoom in and edit</div>
    </>
  );
}

function LinkCard({ idx, link }: { idx: SiteIndex; link: Link | undefined }) {
  if (!link) return null;
  const k = idx.linkKeys.get(link.id);
  const from = idx.devicesById.get(link.fromDevice);
  const to = link.toDevice ? idx.devicesById.get(link.toDevice) : null;
  const fromPort = k?.from.length === 1 ? `Port ${k.from[0]}` : link.fromPort;
  const toPort = k?.to.length === 1 ? `Port ${k.to[0]}` : link.toPort;
  return (
    <>
      <div className="hc-head">
        <div className="hc-title">Cable{link.cableLabel ? ` “${link.cableLabel}”` : ''}</div>
        <StatusPill status={link.status} />
      </div>
      <dl className="hc-rows">
        <dt>From</dt><dd>{from?.name ?? link.fromDevice}{fromPort ? ` · ${fromPort}` : ''}</dd>
        <dt>To</dt><dd>{to ? `${to.name}${toPort ? ` · ${toPort}` : ''}` : link.toExternal || 'Untracked'}</dd>
        {link.cableColor && (<><dt>Color</dt><dd style={{ display: 'flex', gap: 6, alignItems: 'center' }}><span className="swatch" style={{ background: CABLE_HEX[link.cableColor] }} />{link.cableColor}</dd></>)}
        {(link.speed || link.poe) && (<><dt>Link</dt><dd>{[link.speed, link.poe ? `PoE${link.poeWatts != null ? ` ${link.poeWatts} W` : ''}` : ''].filter(Boolean).join(' · ')}</dd></>)}
      </dl>
      {link.notes && <div className="hc-notes">{link.notes}</div>}
    </>
  );
}
