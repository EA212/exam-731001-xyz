import React from 'react';

interface ReactCardProps {
  title: string;
  body: string;
  href: string;
}

export default function ReactCard({ title, body, href }: ReactCardProps) {
  return (
    <li className="link-card">
      <a href={href}>
        <h2>
          {title}
          <span>&rarr;</span>
        </h2>
        <p>{body}</p>
      </a>
    </li>
  );
}
