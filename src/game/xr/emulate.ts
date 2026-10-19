/**
 * Development only: `?xr=emulate` installs IWER (Meta's WebXR emulator) so the
 * VR mode can be entered and tested on a desktop browser without a headset.
 * The emulated device is exposed as `window.__xrDevice` for scripted tests
 * (move the head/controllers, press buttons, switch to tracked hands).
 */
export async function maybeInstallXREmulator() {
  if (!import.meta.env.DEV) return
  const params = new URLSearchParams(location.search)
  if (params.get('xr') !== 'emulate') return
  const { XRDevice, metaQuest3 } = await import('iwer')
  const device = new XRDevice(metaQuest3)
  device.installRuntime({ forceInstall: true })
  device.position.set(0, 1.62, 0)
  ;(window as unknown as { __xrDevice: unknown }).__xrDevice = device
  console.info('[xr] IWER emulator installed (Meta Quest 3)')
}
