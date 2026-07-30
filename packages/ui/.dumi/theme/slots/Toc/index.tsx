import DefaultToc from "dumi/theme-default/slots/Toc";
import "../../style.css";

export default function Toc() {
  return (
    <nav className="clawbot-toc" aria-label="页内目录">
      <p className="clawbot-toc__label">On this page</p>
      <DefaultToc />
    </nav>
  );
}
