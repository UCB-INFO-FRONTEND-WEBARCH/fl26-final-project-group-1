import React, { memo, useEffect, useRef, useState } from 'react';
import { IS_HEPHAESTUS, MAP, HAS_ELEVATOR, MAP_SIZE, MAP_TITLE } from './world.js';
import { SCENE_WALLS, SCENE_FURNITURE, FURNITURE_ASSETS, ROOM_LABELS, SPAWN } from './scene_layout.js';
import { FLOOR_NAMES, FLOOR_HEIGHT, ELEVATOR, STAIRS, BUILDING_BOUNDS, on_stairs } from './building.js';
import { SEATS } from './seat.js';
import { Icon } from './icons.jsx';

const MapGeometry = memo(function MapGeometry({ floor }) {
  return (<>
        <rect x={BUILDING_BOUNDS[0]} y={-BUILDING_BOUNDS[3]} width={BUILDING_BOUNDS[1]-BUILDING_BOUNDS[0]} height={BUILDING_BOUNDS[3]-BUILDING_BOUNDS[2]} rx="0.1" fill="#f3f4f6" />
        <g transform="scale(1,-1)">
          {!IS_HEPHAESTUS && SCENE_WALLS.map((box) => (
            <rect
              key={box.name}
              x={box.center[0] - box.size[0] / 2}
              y={box.center[1] - box.size[1] / 2}
              width={box.size[0]}
              height={box.size[1]}
              fill="#92959d"
            />
          ))}
          {IS_HEPHAESTUS && <>
            {MAP.floor_polygons[floor].map((p,i)=><polygon key={`floor-${i}`} points={p.map(v=>v.join(',')).join(' ')} fill="#e8e4da"/>)}
            {MAP.floor_holes[floor].map((p,i)=><polygon key={`hole-${i}`} points={p.map(v=>v.join(',')).join(' ')} fill="#f3f4f6"/>)}
            {MAP.obstacle_areas[floor].map((rings,i)=><path key={`obstacle-${i}`} d={rings.map(r=>'M'+r.map(v=>v.join(',')).join('L')+'Z').join(' ')} fillRule="evenodd" fill="#a4b2b4"/>)}
            {MAP.stair_regions.map(([l,r,b,t],i)=><rect key={`stairs-${i}`} x={l} y={b} width={r-l} height={t-b} fill="#b7bdc6"/>)}
          </>}
          {!IS_HEPHAESTUS && <rect className="map-stairs" x={STAIRS.opening[0]} y={STAIRS.opening[2]} width={STAIRS.opening[1] - STAIRS.opening[0]} height={STAIRS.opening[3] - STAIRS.opening[2]} fill="#b7bdc6">
            <title>Stairway — click to attempt climbing</title>
          </rect>}
          {HAS_ELEVATOR && <rect x={ELEVATOR.center[0] - 0.85} y={ELEVATOR.center[1] - 0.85} width="1.7" height="1.7" fill="#b1ccec" />}
          {SCENE_FURNITURE.filter(item => Math.floor((item.position[2] + 0.01) / FLOOR_HEIGHT) === floor).map((item) => (
            <rect key={item.name}
              transform={`translate(${item.position[0]},${item.position[1]}) rotate(${item.yaw * 180 / Math.PI})`}
              x={-FURNITURE_ASSETS[item.article].size[0] / 2} y={-FURNITURE_ASSETS[item.article].size[1] / 2}
              width={FURNITURE_ASSETS[item.article].size[0]} height={FURNITURE_ASSETS[item.article].size[1]}
              fill="#cbd1da" rx="0.03" />
          ))}
          <circle cx={SPAWN[0]} cy={SPAWN[1]} r="0.27" fill="none" stroke="#9bbce9" strokeWidth="0.06" />
        </g>
        {ROOM_LABELS.map((room) => (
          <text
            key={room.name}
            x={room.position[0]}
            y={-room.position[1] + 0.22}
            fontSize="0.34"
            textAnchor="middle"
            fill="#86868b"
            fontFamily="monospace"
          >
            {room.number}
          </text>
        ))}
  </>);
});

export function MiniMap({ telemetry, floor, on_destination, on_teleport, on_expand, teleport_mode, local_view, children }) {
  const container_ref = useRef(null);
  const svg_ref = useRef(null);
  const drag_ref = useRef(null);
  const [drop_point, set_drop_point] = useState(null);
  useEffect(() => {
    if (!local_view) container_ref.current?.querySelector('.map-close')?.focus({ preventScroll: true });
  }, [local_view]);

  function map_keys(event) {
    if (local_view || event.key !== 'Tab') return;
    const buttons = [...container_ref.current.querySelectorAll('button:not(:disabled)')];
    if (event.shiftKey && event.target === buttons[0]) { event.preventDefault(); buttons.at(-1).focus(); }
    else if (!event.shiftKey && event.target === buttons.at(-1)) { event.preventDefault(); buttons[0].focus(); }
  }

  function map_point(event) {
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(svg_ref.current.getScreenCTM().inverse());
    return [point.x, -point.y, floor];
  }
  function drop_target(event) {
    const bounds = svg_ref.current.getBoundingClientRect();
    return event.clientX >= bounds.left && event.clientX <= bounds.right &&
      event.clientY >= bounds.top && event.clientY <= bounds.bottom ? map_point(event) : null;
  }
  function start_drag(event) {
    if (event.button !== 0 || drag_ref.current !== null) return;
    event.stopPropagation();
    event.preventDefault();
    drag_ref.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function drag(event) {
    if (drag_ref.current === event.pointerId) set_drop_point(drop_target(event));
  }
  function finish_drag(event, cancelled = false) {
    if (drag_ref.current !== event.pointerId) return;
    const target = cancelled ? null : drop_target(event);
    drag_ref.current = null;
    set_drop_point(null);
    if (target) on_teleport(target);
  }
  const drag_handlers = { onPointerDown: start_drag, onPointerMove: drag, onPointerUp: finish_drag,
    onPointerCancel: event => finish_drag(event, true), onLostPointerCapture: event => finish_drag(event, true),
    onClick: event => event.stopPropagation() };
  return (
    <div ref={container_ref} className={`minimap ${local_view ? 'local-map' : 'expanded-map'}`} onKeyDown={map_keys}
      role={local_view ? undefined : 'dialog'} aria-modal={local_view ? undefined : true} aria-label={local_view ? undefined : 'Map'}>
      <div className="map-heading">
        <span>
          <span className="tiny-square" /> {local_view ? FLOOR_NAMES[floor] : MAP_TITLE}
        </span>
        <span>{FLOOR_NAMES[floor]} · {MAP_SIZE}</span>
        <button className="teleport-grab" aria-label="Grab robot to teleport" title="Drag the robot onto open floor"
          {...drag_handlers}><Icon name="robot" size={19} /></button>
        {local_view && <button className="map-expand" aria-label="Expand map" title="M · Map" onClick={on_expand}><kbd>M</kbd></button>}
      </div>
      {children}
      <svg ref={svg_ref} viewBox={local_view
        ? `${telemetry.position[0] - 4.5} ${-telemetry.position[1] - 4.5} 9 9`
        : `${BUILDING_BOUNDS[0]-.5} ${-BUILDING_BOUNDS[3]-.5} ${BUILDING_BOUNDS[1]-BUILDING_BOUNDS[0]+1} ${BUILDING_BOUNDS[3]-BUILDING_BOUNDS[2]+1}`} aria-label="Floor plan: click an open spot to set a destination" role="img"
        onClick={event => {
          on_destination(map_point(event));
        }}>
        <MapGeometry floor={floor} />
        <g transform="scale(1,-1)">
          {(telemetry.navigation?.path || []).slice(1).map((point, index) => {
            const previous = telemetry.navigation.path[index];
            return (point[2] === floor * FLOOR_HEIGHT && previous[2] === point[2]) ||
              (on_stairs(point) && on_stairs(previous))
              ? <line key={index} x1={previous[0]} y1={previous[1]} x2={point[0]} y2={point[1]} stroke="#0071e3" strokeWidth="0.08" /> : null;
          })}
          {telemetry.navigation?.goal && (telemetry.navigation.goal[2] === floor || on_stairs(telemetry.navigation.goal)) &&
            <circle cx={telemetry.navigation.goal[0]} cy={telemetry.navigation.goal[1]} r="0.2" fill="#0071e3" />}
          {SEATS.filter(seat => seat.floor === floor).map(seat => <circle key={seat.id} className="map-seat"
            cx={seat.front[0]} cy={seat.front[1]} r="0.14"
            data-nearby={telemetry.seat?.nearby?.id === seat.id} />)}
          <g className="map-robot" opacity={telemetry.floor === floor ? 1 : 0.2} {...drag_handlers}
            transform={`translate(${telemetry.position[0]},${telemetry.position[1]}) rotate(${(telemetry.heading * 180) / Math.PI})`}
          >
            <circle r="0.4" fill="#dcecff" stroke="#0071e3" strokeWidth="0.07" />
            <path d="M.65 0 .07 .22 .07 -.22Z" fill="#0071e3" />
          </g>
          {drop_point && <g className="teleport-target" transform={`translate(${drop_point[0]},${drop_point[1]})`}>
            <circle r="0.55" fill="#0071e330" stroke="#0071e3" strokeWidth="0.09" />
            <path d="M-.2 0H.2M0 -.2V.2" stroke="#0071e3" strokeWidth="0.08" />
          </g>}
        </g>
      </svg>
      <div className="map-legend">
        <i /> Berkeley Lite Pro <span>{teleport_mode ? 'Drop to teleport' : 'Click to go'}</span>
      </div>
    </div>
  );
}

