// Browser requests use the public route, because service bindings only exist
// in server-side functions. Vercel and the local Vite proxy both serve /api.
export const API_URL = "/api";

export function schoolYearRequest(yearId) {
  return yearId === undefined ? undefined : { params: { school_year_id: yearId } };
}
