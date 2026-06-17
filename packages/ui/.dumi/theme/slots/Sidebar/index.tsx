import { NavLink, useSidebarData } from "dumi";
import "dumi/theme-default/slots/Sidebar/index.less";
import "../../style.css";

export default function Sidebar() {
  const sidebar = useSidebarData();

  if (!sidebar) {
    return null;
  }

  return (
    <div className="dumi-default-sidebar">
      {sidebar.map((item, index) => (
        <dl className="dumi-default-sidebar-group" key={String(index)}>
          {item.title ? <dt>{item.title}</dt> : null}
          {item.children.map((child) => (
            <dd key={child.link}>
              <NavLink to={child.link} title={child.title} end>
                {child.title}
              </NavLink>
            </dd>
          ))}
        </dl>
      ))}
    </div>
  );
}
