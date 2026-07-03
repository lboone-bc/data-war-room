import Link from "next/link";

export default function Home() {
  return (
    <main className="home">
      <section className="home-panel">
        <p className="eyebrow">Private wallboard</p>
        <h1>Data Monitoring Room</h1>
        <p>
          A cinematic realtime operations display built for a single landscape TV.
        </p>
        <Link href="/wallboard" className="home-link">
          Open wallboard
        </Link>
      </section>
    </main>
  );
}

