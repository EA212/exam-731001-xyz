import type { APIRoute } from 'astro';

export const GET: APIRoute = () => {
  const cards = [
    {
      href: 'https://docs.astro.build/en/core-concepts/astro-components/',
      title: 'Components',
      body: 'Learn how to build reusable UI with Astro components.'
    },
    {
      href: 'https://docs.astro.build/en/core-concepts/routing/',
      title: 'Routing',
      body: 'Understand file-based routing and dynamic routes.'
    },
    {
      href: 'https://docs.astro.build/en/guides/fonts/',
      title: 'Typography',
      body: 'Add custom fonts and improve your site typography.'
    },
    {
      href: 'https://docs.astro.build/en/guides/images/',
      title: 'Images',
      body: 'Optimize and lazy-load images for better performance.'
    }
  ];

  return new Response(JSON.stringify(cards), {
    status: 200,
    headers: {
      'Content-Type': 'application/json'
    }
  });
};

