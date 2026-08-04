import type { AddonValues, CanvasAddonMountContext } from '../generated/mywallpaper-runtime'
import './styles.css'

const vertexSource = `#version 300 es
precision mediump float;
const vec2 positions[6] = vec2[6](vec2(-1.,-1.),vec2(1.,-1.),vec2(-1.,1.),vec2(-1.,1.),vec2(1.,-1.),vec2(1.,1.));
out vec2 uv;
void main(){uv=positions[gl_VertexID];gl_Position=vec4(positions[gl_VertexID],0.,1.);}`

const fragmentSource = `#version 300 es
precision highp float;
uniform float u_time; uniform vec2 u_resolution; uniform vec3 u_primaryColor; uniform vec3 u_secondaryColor;
uniform float u_intensity; uniform float u_speed; uniform float u_scale; uniform float u_turbulence; uniform float u_height; uniform float u_opacity;
in vec2 uv; out vec4 fragColor;
float random(vec2 st){return fract(sin(dot(st.xy,vec2(12.9898,78.233)))*43758.5453123);}
float noise(vec2 st){vec2 i=floor(st),f=fract(st),u=f*f*(3.-2.*f);float a=random(i),b=random(i+vec2(1.,0.)),c=random(i+vec2(0.,1.)),d=random(i+vec2(1.,1.));return mix(a,b,u.x)+(c-a)*u.y*(1.-u.x)+(d-b)*u.x*u.y;}
float fbm(vec2 st){float value=0.,amplitude=.4;for(int i=0;i<5;i++){value+=amplitude*noise(st);st*=2.;amplitude*=.4;}return value;}
void main(){vec2 st=uv;st.x*=u_resolution.x/max(u_resolution.y,1.);vec2 fc=vec2(st.x,st.y-u_time*u_speed)*u_scale;float gradient=mix(st.y*.3,st.y*.7,fbm(fc));float n1=fbm(fc),n2=u_turbulence*fbm(fc+n1+u_time)-.5;float fire=fbm(vec2(n2,n1));vec3 color=mix(u_secondaryColor,u_primaryColor,fire)*u_intensity;float alpha=smoothstep(0.,1.,(fire-gradient+.3)*u_height);fragColor=vec4(color,alpha*u_opacity);}`

interface Settings {
  primaryColor: string
  secondaryColor: string
  intensity: number
  speed: number
  scale: number
  turbulence: number
  height: number
  opacity: number
}

const defaults: Settings = {
  primaryColor: '#ff6b35', secondaryColor: '#ff0000', intensity: 0.9, speed: 0.2,
  scale: 7, turbulence: 0.9, height: 1, opacity: 1,
}

export function mount({ layer }: CanvasAddonMountContext): () => void {
  const canvas = document.createElement('canvas')
  canvas.className = 'fire-shader'
  layer.root.replaceChildren(canvas)
  const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false, antialias: true })
  if (!gl) {
    const error = document.createElement('p')
    error.className = 'fire-shader__error'
    error.textContent = 'WebGL2 is unavailable on this device.'
    layer.root.replaceChildren(error)
    return () => layer.root.replaceChildren()
  }

  const program = createProgram(gl)
  if (!program) {
    const error = document.createElement('p')
    error.className = 'fire-shader__error'
    error.textContent = 'The fire shader could not be initialized.'
    layer.root.replaceChildren(error)
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return () => layer.root.replaceChildren()
  }

  gl.enable(gl.BLEND)
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
  gl.useProgram(program)
  const uniforms = {
    time: gl.getUniformLocation(program, 'u_time'), resolution: gl.getUniformLocation(program, 'u_resolution'),
    primary: gl.getUniformLocation(program, 'u_primaryColor'), secondary: gl.getUniformLocation(program, 'u_secondaryColor'),
    intensity: gl.getUniformLocation(program, 'u_intensity'), speed: gl.getUniformLocation(program, 'u_speed'),
    scale: gl.getUniformLocation(program, 'u_scale'), turbulence: gl.getUniformLocation(program, 'u_turbulence'),
    height: gl.getUniformLocation(program, 'u_height'), opacity: gl.getUniformLocation(program, 'u_opacity'),
  }
  let settings = readSettings(layer.settings.get())
  let frame = 0
  let disposed = false
  const started = performance.now()

  const resize = (): void => {
    const rect = layer.root.getBoundingClientRect()
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const width = Math.max(1, Math.round(rect.width * dpr))
    const height = Math.max(1, Math.round(rect.height * dpr))
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
      gl.viewport(0, 0, width, height)
    }
  }
  const draw = (): void => {
    if (disposed) return
    resize()
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.uniform1f(uniforms.time, (performance.now() - started) / 1000)
    gl.uniform2f(uniforms.resolution, canvas.width, canvas.height)
    gl.uniform3fv(uniforms.primary, hexToRgb(settings.primaryColor))
    gl.uniform3fv(uniforms.secondary, hexToRgb(settings.secondaryColor))
    gl.uniform1f(uniforms.intensity, settings.intensity)
    gl.uniform1f(uniforms.speed, settings.speed)
    gl.uniform1f(uniforms.scale, settings.scale)
    gl.uniform1f(uniforms.turbulence, settings.turbulence)
    gl.uniform1f(uniforms.height, settings.height)
    gl.uniform1f(uniforms.opacity, settings.opacity)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
    frame = requestAnimationFrame(draw)
  }
  const unsubscribe = layer.settings.subscribe((values) => { settings = readSettings(values) })
  frame = requestAnimationFrame(draw)

  return () => {
    disposed = true
    cancelAnimationFrame(frame)
    unsubscribe()
    gl.deleteProgram(program)
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    layer.root.replaceChildren()
  }
}

function createProgram(gl: WebGL2RenderingContext): WebGLProgram | null {
  const vertex = compile(gl, vertexSource, gl.VERTEX_SHADER)
  const fragment = compile(gl, fragmentSource, gl.FRAGMENT_SHADER)
  if (!vertex || !fragment) return null
  const program = gl.createProgram()
  if (!program) return null
  gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program)
  gl.deleteShader(vertex); gl.deleteShader(fragment)
  if (gl.getProgramParameter(program, gl.LINK_STATUS)) return program
  gl.deleteProgram(program)
  return null
}

function compile(gl: WebGL2RenderingContext, source: string, type: number): WebGLShader | null {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source); gl.compileShader(shader)
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader
  gl.deleteShader(shader)
  return null
}

function readSettings(values: AddonValues): Settings {
  const number = (key: keyof Settings): number => typeof values[key] === 'number' ? values[key] as number : defaults[key] as number
  const color = (key: 'primaryColor' | 'secondaryColor'): string => typeof values[key] === 'string' ? values[key] : defaults[key]
  return { primaryColor: color('primaryColor'), secondaryColor: color('secondaryColor'), intensity: number('intensity'), speed: number('speed'), scale: number('scale'), turbulence: number('turbulence'), height: number('height'), opacity: number('opacity') }
}

function hexToRgb(value: string): [number, number, number] {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})/iu.exec(value)
  return match ? [parseInt(match[1], 16) / 255, parseInt(match[2], 16) / 255, parseInt(match[3], 16) / 255] : [1, 1, 1]
}
