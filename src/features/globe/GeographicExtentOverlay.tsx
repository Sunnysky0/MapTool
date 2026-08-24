import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { Html } from '@react-three/drei';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { Color, Vector2 } from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import {
  clampLatitude,
  intersectRayWithGlobe,
  longitudeSpan,
  lonLatToVector3,
  normalizeLongitude,
  OVERLAY_RADIUS,
  splitLongitudeIntervals,
  type GeographicExtent,
  type LonLat,
} from './globe-math';

export type ExtentHandleId =
  'north-west' | 'north' | 'north-east' | 'east' | 'south-east' | 'south' | 'south-west' | 'west';

export interface GeographicExtentOverlayProps {
  extent: GeographicExtent;
  onExtentChange: (extent: GeographicExtent) => void;
  onExtentCommit?: (extent: GeographicExtent) => void;
  onExtentCancel?: (extent: GeographicExtent) => void;
  onDragChange?: (dragging: boolean) => void;
  radius?: number;
  sampleStepDegrees?: number;
  color?: string;
  lineWidth?: number;
  handleColor?: string;
}

const GLOBE_DRAG_RADIUS = 1;

interface HandleDefinition {
  id: ExtentHandleId;
  longitude: number;
  latitude: number;
  label: string;
}

function longitudeMidpoint(extent: GeographicExtent): number {
  return normalizeLongitude(extent.west + longitudeSpan(extent.west, extent.east) / 2);
}

function extentHandles(extent: GeographicExtent): HandleDefinition[] {
  const middleLongitude = longitudeMidpoint(extent);
  const middleLatitude = (extent.south + extent.north) / 2;
  return [
    {
      id: 'north-west',
      longitude: extent.west,
      latitude: extent.north,
      label: 'North-west extent handle',
    },
    {
      id: 'north',
      longitude: middleLongitude,
      latitude: extent.north,
      label: 'North extent handle',
    },
    {
      id: 'north-east',
      longitude: extent.east,
      latitude: extent.north,
      label: 'North-east extent handle',
    },
    {
      id: 'east',
      longitude: extent.east,
      latitude: middleLatitude,
      label: 'East extent handle',
    },
    {
      id: 'south-east',
      longitude: extent.east,
      latitude: extent.south,
      label: 'South-east extent handle',
    },
    {
      id: 'south',
      longitude: middleLongitude,
      latitude: extent.south,
      label: 'South extent handle',
    },
    {
      id: 'south-west',
      longitude: extent.west,
      latitude: extent.south,
      label: 'South-west extent handle',
    },
    {
      id: 'west',
      longitude: extent.west,
      latitude: middleLatitude,
      label: 'West extent handle',
    },
  ];
}

function sampleRange(start: number, end: number, maximumStep: number): number[] {
  const stepCount = Math.max(1, Math.ceil(Math.abs(end - start) / maximumStep));
  return Array.from({ length: stepCount + 1 }, (_, index) => {
    return start + ((end - start) * index) / stepCount;
  });
}

function appendPolyline(positions: number[], points: LonLat[], radius: number): void {
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    if (!start || !end) continue;
    const startPosition = lonLatToVector3(start.longitude, start.latitude, radius);
    const endPosition = lonLatToVector3(end.longitude, end.latitude, radius);
    positions.push(
      startPosition.x,
      startPosition.y,
      startPosition.z,
      endPosition.x,
      endPosition.y,
      endPosition.z,
    );
  }
}

function buildBoundaryPositions(
  extent: GeographicExtent,
  radius: number,
  maximumStep: number,
): Float32Array {
  const positions: number[] = [];
  const south = Math.min(extent.south, extent.north);
  const north = Math.max(extent.south, extent.north);

  for (const [west, east] of splitLongitudeIntervals(extent)) {
    const longitudes = sampleRange(west, east, maximumStep);
    appendPolyline(
      positions,
      longitudes.map((longitude) => ({ longitude, latitude: north })),
      radius,
    );
    appendPolyline(
      positions,
      longitudes.map((longitude) => ({ longitude, latitude: south })),
      radius,
    );
  }

  const latitudes = sampleRange(south, north, maximumStep);
  appendPolyline(
    positions,
    latitudes.map((latitude) => ({ longitude: extent.west, latitude })),
    radius,
  );
  appendPolyline(
    positions,
    latitudes.map((latitude) => ({ longitude: extent.east, latitude })),
    radius,
  );
  return new Float32Array(positions);
}

function applyHandleDrag(
  extent: GeographicExtent,
  handle: ExtentHandleId,
  point: LonLat,
): GeographicExtent {
  const next = { ...extent };

  if (handle.includes('north') || handle === 'north') {
    next.north = Math.max(point.latitude, next.south);
  }
  if (handle.includes('south') || handle === 'south') {
    next.south = Math.min(point.latitude, next.north);
  }
  if (handle.includes('west') || handle === 'west') {
    next.west = normalizeLongitude(point.longitude);
  }
  if (handle.includes('east') || handle === 'east') {
    next.east = normalizeLongitude(point.longitude);
  }

  next.south = clampLatitude(next.south);
  next.north = clampLatitude(next.north);
  return next;
}

interface ExtentHandleProps {
  definition: HandleDefinition;
  radius: number;
  color: string;
  active: boolean;
  onPointerDown: (event: ThreeEvent<PointerEvent>, handle: ExtentHandleId) => void;
  onKeyboardAdjust: (event: ReactKeyboardEvent<HTMLButtonElement>, handle: ExtentHandleId) => void;
}

function ExtentHandle({
  definition,
  radius,
  color,
  active,
  onPointerDown,
  onKeyboardAdjust,
}: ExtentHandleProps) {
  const position = lonLatToVector3(definition.longitude, definition.latitude, radius);
  return (
    <mesh
      position={position}
      renderOrder={6}
      onPointerDown={(event) => onPointerDown(event, definition.id)}
      userData={{ role: 'button', ariaLabel: definition.label, handleId: definition.id }}
      name={`extent-handle-${definition.id}`}
    >
      <sphereGeometry args={[active ? 0.026 : 0.021, 16, 12]} />
      <meshBasicMaterial
        color={active ? '#ffffff' : color}
        depthTest={false}
        transparent
        opacity={0.98}
        toneMapped={false}
      />
      <Html center zIndexRange={[0, 0]} style={{ pointerEvents: 'none' }}>
        <button
          type="button"
          aria-label={definition.label}
          onKeyDown={(event) => onKeyboardAdjust(event, definition.id)}
          style={{
            position: 'absolute',
            width: 30,
            height: 30,
            transform: 'translate(-50%, -50%)',
            opacity: 0,
            pointerEvents: 'none',
          }}
        />
      </Html>
    </mesh>
  );
}

export function GeographicExtentOverlay({
  extent,
  onExtentChange,
  onExtentCommit,
  onExtentCancel,
  onDragChange,
  radius = OVERLAY_RADIUS,
  sampleStepDegrees = 2,
  color = '#ffca62',
  lineWidth = 2,
  handleColor = '#ffd67c',
}: GeographicExtentOverlayProps) {
  if (!(radius > 0)) throw new Error('Extent overlay radius must be greater than zero.');
  if (!(sampleStepDegrees > 0)) {
    throw new Error('Extent overlay sampleStepDegrees must be greater than zero.');
  }

  const { camera, gl, raycaster } = useThree();
  const dragRef = useRef<{
    handle: ExtentHandleId;
    pointerId: number;
    captureTarget: HTMLCanvasElement;
    lastPoint: LonLat;
  } | null>(null);
  const startExtentRef = useRef<GeographicExtent | null>(null);
  const latestExtentRef = useRef(extent);
  const onExtentChangeRef = useRef(onExtentChange);
  const onExtentCommitRef = useRef(onExtentCommit);
  const onExtentCancelRef = useRef(onExtentCancel);
  const onDragChangeRef = useRef(onDragChange);
  const [activeHandle, setActiveHandle] = useState<ExtentHandleId | null>(null);

  useEffect(() => {
    if (!dragRef.current) latestExtentRef.current = extent;
  }, [extent]);
  useEffect(() => {
    onExtentChangeRef.current = onExtentChange;
  }, [onExtentChange]);
  useEffect(() => {
    onExtentCommitRef.current = onExtentCommit;
  }, [onExtentCommit]);
  useEffect(() => {
    onExtentCancelRef.current = onExtentCancel;
  }, [onExtentCancel]);
  useEffect(() => {
    onDragChangeRef.current = onDragChange;
  }, [onDragChange]);

  const boundary = useMemo(() => {
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(buildBoundaryPositions(extent, radius, sampleStepDegrees));
    const material = new LineMaterial({
      color: new Color(color),
      linewidth: lineWidth,
      transparent: true,
      opacity: 0.96,
      depthWrite: false,
      depthTest: false,
      alphaToCoverage: true,
      worldUnits: false,
    });
    const line = new LineSegments2(geometry, material);
    line.name = 'geographic-extent-boundary';
    line.renderOrder = 5;
    return { geometry, material, line };
  }, [color, extent, lineWidth, radius, sampleStepDegrees]);

  useEffect(() => {
    return () => {
      boundary.geometry.dispose();
      boundary.material.dispose();
    };
  }, [boundary]);

  useEffect(() => {
    const canvas = gl.domElement;

    const updateFromPointer = (pointer: Vector2): void => {
      const drag = dragRef.current;
      if (!drag) return;
      raycaster.setFromCamera(pointer, camera);
      const point = intersectRayWithGlobe(raycaster.ray, GLOBE_DRAG_RADIUS) ?? drag.lastPoint;
      drag.lastPoint = point;
      const next = applyHandleDrag(latestExtentRef.current, drag.handle, point);
      latestExtentRef.current = next;
      onExtentChangeRef.current(next);
    };

    const onPointerMove = (event: PointerEvent): void => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const bounds = canvas.getBoundingClientRect();
      if (bounds.width === 0 || bounds.height === 0) return;

      const pointerX = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
      const pointerY = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
      updateFromPointer(new Vector2(pointerX, pointerY));
      event.preventDefault();
    };

    const finishDrag = (event: PointerEvent): void => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      dragRef.current = null;
      startExtentRef.current = null;
      if (drag.captureTarget.hasPointerCapture(event.pointerId)) {
        drag.captureTarget.releasePointerCapture(event.pointerId);
      }
      setActiveHandle(null);
      onDragChangeRef.current?.(false);
      onExtentCommitRef.current?.(latestExtentRef.current);
    };

    const cancelDrag = (): void => {
      const drag = dragRef.current;
      if (!drag) return;
      const original = startExtentRef.current;
      dragRef.current = null;
      startExtentRef.current = null;
      if (drag.captureTarget.hasPointerCapture(drag.pointerId)) {
        drag.captureTarget.releasePointerCapture(drag.pointerId);
      }
      setActiveHandle(null);
      onDragChangeRef.current?.(false);
      if (original) {
        latestExtentRef.current = original;
        onExtentChangeRef.current(original);
        onExtentCancelRef.current?.(original);
      }
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') cancelDrag();
    };
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', finishDrag);
    canvas.addEventListener('pointercancel', cancelDrag);
    canvas.addEventListener('lostpointercapture', cancelDrag);
    window.addEventListener('blur', cancelDrag);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', finishDrag);
      canvas.removeEventListener('pointercancel', cancelDrag);
      canvas.removeEventListener('lostpointercapture', cancelDrag);
      window.removeEventListener('blur', cancelDrag);
      window.removeEventListener('keydown', onKeyDown);
      if (dragRef.current) cancelDrag();
    };
  }, [camera, gl, raycaster]);

  const handlePointerDown = (event: ThreeEvent<PointerEvent>, handle: ExtentHandleId): void => {
    if (event.nativeEvent.button !== 0 || !event.nativeEvent.isPrimary) return;
    event.stopPropagation();
    event.nativeEvent.stopImmediatePropagation();
    const captureTarget = gl.domElement;
    const definition = extentHandles(latestExtentRef.current).find((item) => item.id === handle);
    if (!definition) return;
    startExtentRef.current = latestExtentRef.current;
    const pointerTarget = event.target as unknown as {
      setPointerCapture(pointerId: number): void;
    };
    pointerTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      handle,
      pointerId: event.pointerId,
      captureTarget,
      lastPoint: { longitude: definition.longitude, latitude: definition.latitude },
    };
    setActiveHandle(handle);
    onDragChange?.(true);
  };

  const handleKeyboardAdjust = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    handle: ExtentHandleId,
  ): void => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const definition = extentHandles(latestExtentRef.current).find((item) => item.id === handle);
    if (!definition) return;
    const longitudeDelta = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
    const latitudeDelta = event.key === 'ArrowDown' ? -1 : event.key === 'ArrowUp' ? 1 : 0;
    const next = applyHandleDrag(latestExtentRef.current, handle, {
      longitude: definition.longitude + longitudeDelta,
      latitude: definition.latitude + latitudeDelta,
    });
    latestExtentRef.current = next;
    onExtentChange(next);
    onExtentCommit?.(next);
  };

  const handles = extentHandles(extent);

  return (
    <group>
      <primitive object={boundary.line} />
      {handles.map((definition) => (
        <ExtentHandle
          key={definition.id}
          definition={definition}
          radius={radius + 0.006}
          color={handleColor}
          active={definition.id === activeHandle}
          onPointerDown={handlePointerDown}
          onKeyboardAdjust={handleKeyboardAdjust}
        />
      ))}
    </group>
  );
}
