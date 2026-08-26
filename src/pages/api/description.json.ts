import type { APIRoute } from 'astro';

export const GET: APIRoute = () => {
  const description = {
    title: 'Interactive API Demo',
    titleHtml: '<span class="text-gradient">API Demo</span>',
    text: 'This page loads data dynamically from API endpoints. Content is fetched server-side and rendered before sending to your browser.',
    code: 'View the API endpoints in <code>src/pages/api</code> directory'
  };

  return new Response(JSON.stringify(description), {
    status: 200,
    headers: {
      'Content-Type': 'application/json'
    }
  });
};

