/** True when running a production deployment (API or Node convention). */
export function isAppProduction(): boolean {
  return (
    process.env.APP_ENV?.trim().toLowerCase() === 'production' ||
    process.env.NODE_ENV === 'production'
  );
}
