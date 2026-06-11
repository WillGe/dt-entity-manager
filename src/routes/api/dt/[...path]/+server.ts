import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * Pass-through proxy to the Dynatrace Environment API v2.
 * The Dynatrace API sends no CORS headers, so the browser cannot call it
 * directly; the client sends its connection config via headers instead.
 */
const forward: RequestHandler = async ({ params, url, request }) => {
	const baseUrl = request.headers.get('x-dt-base-url')?.replace(/\/+$/, '');
	const token = request.headers.get('x-dt-token');

	if (!baseUrl || !token) {
		return json(
			{ error: { message: 'Missing x-dt-base-url or x-dt-token header' } },
			{ status: 400 }
		);
	}
	if (!/^https:\/\/[^/]+/.test(baseUrl)) {
		return json(
			{ error: { message: 'Environment URL must be https://...' } },
			{ status: 400 }
		);
	}

	const target = `${baseUrl}/api/v2/${params.path}${url.search}`;
	const init: RequestInit = {
		method: request.method,
		headers: {
			Authorization: `Api-Token ${token}`,
			...(request.method !== 'GET' ? { 'Content-Type': 'application/json' } : {})
		},
		body: request.method !== 'GET' ? await request.text() : undefined
	};

	let upstream: Response;
	try {
		upstream = await fetch(target, init);
	} catch (e) {
		return json(
			{ error: { message: `Could not reach Dynatrace at ${baseUrl}: ${e instanceof Error ? e.message : e}` } },
			{ status: 502 }
		);
	}

	const headers = new Headers({
		'content-type': upstream.headers.get('content-type') ?? 'application/json'
	});
	const retryAfter = upstream.headers.get('retry-after');
	if (retryAfter) headers.set('retry-after', retryAfter);

	return new Response(await upstream.text(), { status: upstream.status, headers });
};

export const GET = forward;
export const POST = forward;
