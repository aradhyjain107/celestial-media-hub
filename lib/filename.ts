/**
 * Split a filename into its base stem and extension (including leading dot)
 * so UI components can apply CSS directional/middle truncation safely.
 */
export function splitFilename(name: string): { stem: string; ext: string } {
  const extIndex = name.lastIndexOf('.');
  if (extIndex > 0 && extIndex > name.length - 10) {
    return { stem: name.slice(0, extIndex), ext: name.slice(extIndex) };
  }
  return { stem: name, ext: '' };
}
