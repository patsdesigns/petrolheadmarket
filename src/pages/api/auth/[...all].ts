import type { APIRoute } from "astro";
import { getAuth } from "../../../lib/auth";

// Better Auth's HTTP API, mounted at /app/api/auth/*.
export const ALL: APIRoute = ({ request }) => getAuth().handler(request);
