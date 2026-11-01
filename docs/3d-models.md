# 3D Models Integration

This document describes the 3D GLB models used in Continuum's immersive visualization features.

## Models

### Core Model (`/models/core.glb`)
- **Source**: Meshy AI Neural Duality
- **Purpose**: Central hub in the memory core visualization
- **Scenes**: Memory Core, Integration Orbit
- **Animation**: Continuous idle rotation (0.35-0.4 rad/s), gentle tilt

### Agent Models

#### ChatGPT (`/models/chatgpt.glb`)
- **Purpose**: Represents ChatGPT agent node in orbit scenes
- **Scenes**: Integration Orbit, Memory Core (when connected)
- **Animation**: Orbital rotation, gentle bobbing motion, idle spin

#### Claude (`/models/claude.glb`)
- **Purpose**: Represents Claude agent node in orbit scenes  
- **Scenes**: Integration Orbit, Memory Core (when connected)
- **Animation**: Orbital rotation, gentle bobbing motion, idle spin

## Fallback Rendering

All models have procedural geometry fallbacks:
- **Core**: Stacked plates (5 boxes with alternating colors)
- **Agents**: Icosahedron spheres (low-poly)

Fallbacks are shown while GLB models load, then hidden once the GLB is ready.

## Loading Strategy

Models are loaded asynchronously using Three.js GLTFLoader:
- Non-blocking: scenes render immediately with fallbacks
- Auto-scaling: models are normalized to consistent sizes
- Error handling: fallback remains visible if GLB fails to load

## Performance

- **Demand rendering**: scenes only render when visible and during animation
- **Low power mode**: WebGL power preference set to "low-power"
- **Pixel ratio cap**: max 1.5x device pixel ratio to reduce GPU load
- **Geometry reuse**: shared procedural geometries across nodes

## Animation Details

### Memory Core Scene
- Core model: 0.4 rad/s Y-axis rotation, subtle X-axis tilt
- Agent nodes: orbital rotation, sine-wave bob, 0.6 rad/s local spin
- Connection lines: animated dots traveling from core to nodes

### Integration Orbit Scene  
- Core model: 0.35 rad/s Y-axis rotation
- Agent nodes: orbital path (2.8 unit radius), 0.18 rad/s orbit speed
- Selected nodes: 1.35x scale boost
- Smooth transitions: all animations use continuous time-based updates

## Browser Compatibility

Requires WebGL 1.0 support. Tested on:
- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

Reduced motion preferences are respected with CSS fallback rendering.
