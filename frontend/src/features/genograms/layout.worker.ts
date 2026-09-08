import { layoutGenogram, type LayoutInput } from './layout';
self.onmessage = (event: MessageEvent<{ revision: number; input: LayoutInput }>) => {
  const { revision, input } = event.data;
  try { self.postMessage({ revision, layout: layoutGenogram(input) }); }
  catch (error) { self.postMessage({ revision, error: String(error) }); }
};
