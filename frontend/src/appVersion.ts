// Release version of the running build, substituted by vite.config.ts from the
// repository VERSION file or from the version the container build was given.
// Unit tests and any build without that substitution see "development".
export const APP_VERSION: string = import.meta.env.VITE_APP_VERSION ?? "development";
