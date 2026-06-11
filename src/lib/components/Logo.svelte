<script lang="ts">
	let { size = 26 }: { size?: number } = $props();
</script>

<!-- Keep in sync with static/favicon.svg -->
<svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
	<defs>
		<linearGradient id="dtem-logo-g" x1="0" y1="0" x2="1" y2="1">
			<stop offset="0" stop-color="#6d4df0" />
			<stop offset="1" stop-color="#4a2fb8" />
		</linearGradient>
	</defs>
	<rect width="32" height="32" rx="7" fill="url(#dtem-logo-g)" />
	<g stroke="#fff" stroke-opacity="0.55" stroke-width="1.6">
		<path d="M11.5 11.5 21.5 14.5M11.5 11.5 13.5 21.5M21.5 14.5 13.5 21.5" />
	</g>
	<circle cx="11.5" cy="11.5" r="3.4" fill="#fff" />
	<circle cx="21.5" cy="14.5" r="2.7" fill="#fff" fill-opacity="0.92" />
	<circle cx="13.5" cy="21.5" r="2.7" fill="#fff" fill-opacity="0.92" />
</svg>
