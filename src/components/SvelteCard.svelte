<script lang="ts">
  interface Props {
    title: string;
    body: string;
    href: string;
  }

  let { title, body, href }: Props = $props();
</script>

<li class="link-card">
  <a href={href}>
    <h2>
      {title}
      <span>&rarr;</span>
    </h2>
    <p>{body}</p>
  </a>
</li>
