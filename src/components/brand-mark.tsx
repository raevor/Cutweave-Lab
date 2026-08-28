import Link from "next/link";

export function BrandMark() {
  return (
    <Link className="brand-mark" href="/" aria-label="Cutweave Lab home">
      <span>CUT</span>
      <span className="brand-slash" aria-hidden="true">/</span>
      <span>WEAVE</span>
      <span className="brand-lab">LAB</span>
    </Link>
  );
}
