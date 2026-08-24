import {
  Component,
  Suspense,
  useRef,
  type CSSProperties,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import {
  ACESFilmicToneMapping,
  MOUSE,
  SRGBColorSpace,
  type WebGLRenderer,
} from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { GeographicExtentOverlay } from './GeographicExtentOverlay';
import { GLOBE_RADIUS, type GeographicExtent } from './globe-math';
import { useGlobeGeometry } from './useGlobeGeometry';

export interface GlobeViewportProps {
  extent: GeographicExtent;
  onExtentChange: (extent: GeographicExtent) => void;
  onExtentCommit?: (extent: GeographicExtent) => void;
  onExtentCancel?: (extent: GeographicExtent) => void;
  className?: string;
  style?: CSSProperties;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback: (error: Error) => ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

class GlobeErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Globe viewport failed to render.', error, info);
  }

  render(): ReactNode {
    return this.state.error ? this.props.fallback(this.state.error) : this.props.children;
  }
}

let cachedWebGLSupport: boolean | undefined;

function supportsWebGL(): boolean {
  if (cachedWebGLSupport !== undefined) return cachedWebGLSupport;
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    const context = window.WebGL2RenderingContext
      ? canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: true })
      : null;
    cachedWebGLSupport = Boolean(context);
    context?.getExtension('WEBGL_lose_context')?.loseContext();
    return cachedWebGLSupport;
  } catch {
    cachedWebGLSupport = false;
    return false;
  }
}

function StatusMessage({
  children,
  role = 'status',
}: {
  children: ReactNode;
  role?: 'alert' | 'status';
}) {
  return (
    <div
      role={role}
      style={{
        display: 'grid',
        width: '100%',
        height: '100%',
        minHeight: 280,
        placeItems: 'center',
        padding: 24,
        color: '#d9e1e8',
        background: '#090d12',
        textAlign: 'center',
        font: '500 0.9rem/1.5 system-ui, sans-serif',
      }}
    >
      {children}
    </div>
  );
}

function GlobeLinework() {
  const { geometry, error, loading } = useGlobeGeometry();
  if (error) throw error;
  if (loading || !geometry) return null;

  return (
    <group>
      <primitive object={geometry.land.line} />
      <primitive object={geometry.lake.line} />
    </group>
  );
}

type GlobeSceneProps = Pick<
  GlobeViewportProps,
  'extent' | 'onExtentChange' | 'onExtentCommit' | 'onExtentCancel'
>;

function GlobeScene({ extent, onExtentChange, onExtentCommit, onExtentCancel }: GlobeSceneProps) {
  const controlsRef = useRef<OrbitControlsImpl>(null);

  return (
    <>
      <color attach="background" args={['#070a0e']} />
      <ambientLight color="#7d8b9c" intensity={0.2} />
      <hemisphereLight args={['#a8b9c9', '#050609', 0.56]} />
      <directionalLight position={[3, 2.2, 4]} color="#e7edf2" intensity={1.15} />
      <directionalLight position={[-4, -1.5, -2]} color="#315169" intensity={0.25} />

      <mesh name="globe-surface" receiveShadow>
        <sphereGeometry args={[GLOBE_RADIUS, 96, 64]} />
        <meshStandardMaterial
          color="#111820"
          roughness={0.91}
          metalness={0.02}
          envMapIntensity={0.12}
        />
      </mesh>

      <Suspense fallback={null}>
        <GlobeLinework />
      </Suspense>

      <GeographicExtentOverlay
        extent={extent}
        onExtentChange={onExtentChange}
        onExtentCommit={onExtentCommit}
        onExtentCancel={onExtentCancel}
        onDragChange={() => undefined}
      />

      <OrbitControls
        ref={controlsRef}
        makeDefault
        enableDamping
        dampingFactor={0.075}
        enablePan={false}
        mouseButtons={{ LEFT: undefined, MIDDLE: MOUSE.ROTATE, RIGHT: undefined }}
        minDistance={1.45}
        maxDistance={6}
        minPolarAngle={0.08}
        maxPolarAngle={Math.PI - 0.08}
        rotateSpeed={0.55}
        zoomSpeed={0.7}
      />
    </>
  );
}

function configureRenderer(renderer: WebGLRenderer): void {
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.86;
}

export function GlobeViewport({
  extent,
  onExtentChange,
  onExtentCommit,
  onExtentCancel,
  className,
  style,
}: GlobeViewportProps) {
  const webGLAvailable = supportsWebGL();

  if (!webGLAvailable) {
    return (
      <StatusMessage role="alert">
        This globe needs WebGL 2 and hardware acceleration. You can continue by editing the
        geographic extent with the numeric controls.
      </StatusMessage>
    );
  }

  return (
    <div
      className={className}
      style={{ position: 'relative', width: '100%', height: '100%', minHeight: 280, ...style }}
      aria-label="Interactive three-dimensional globe"
    >
      <GlobeErrorBoundary
        fallback={(error) => (
          <StatusMessage role="alert">
            The 3D globe could not be displayed.{' '}
            {error.message || 'Please use the numeric extent controls.'}
          </StatusMessage>
        )}
      >
        <Canvas
          camera={{ position: [0, 0.18, 2.75], fov: 42, near: 0.05, far: 50 }}
          dpr={[1, 2]}
          fallback={
            <StatusMessage role="alert">
              WebGL is unavailable. Use the numeric controls to edit the geographic extent.
            </StatusMessage>
          }
          gl={{
            antialias: true,
            alpha: false,
            powerPreference: 'high-performance',
          }}
          onCreated={({ gl }) => configureRenderer(gl)}
          resize={{ debounce: { resize: 80, scroll: 50 } }}
        >
          <GlobeScene
            extent={extent}
            onExtentChange={onExtentChange}
            onExtentCommit={onExtentCommit}
            onExtentCancel={onExtentCancel}
          />
        </Canvas>
      </GlobeErrorBoundary>
    </div>
  );
}
