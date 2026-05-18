import { type ReactNode, createContext, useCallback, useContext, useState } from 'react';

interface MenuItem {
  label: string;
  onClick: () => void;
  destructive?: boolean;
}

interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

interface ContextMenuApi {
  open(x: number, y: number, items: MenuItem[]): void;
}

const Ctx = createContext<ContextMenuApi | null>(null);

export function ContextMenuProvider({ children }: { children: ReactNode }) {
  const [menu, setMenu] = useState<MenuState | null>(null);

  const open = useCallback((x: number, y: number, items: MenuItem[]) => {
    setMenu({ x, y, items });
  }, []);

  const close = useCallback(() => setMenu(null), []);

  return (
    <Ctx.Provider value={{ open }}>
      {children}
      {menu ? (
        <>
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: dismissal shield; Esc handling is on the menu itself */}
          <div
            className="context-menu__shield"
            onClick={close}
            onContextMenu={(e) => e.preventDefault()}
            role="presentation"
          />
          <ul
            className="context-menu"
            style={{ left: menu.x, top: menu.y }}
            onContextMenu={(e) => e.preventDefault()}
          >
            {menu.items.map((it) => (
              <li key={it.label}>
                <button
                  type="button"
                  className={
                    it.destructive
                      ? 'context-menu__item context-menu__item--destructive'
                      : 'context-menu__item'
                  }
                  onClick={() => {
                    it.onClick();
                    close();
                  }}
                >
                  {it.label}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </Ctx.Provider>
  );
}

export function useContextMenu(): ContextMenuApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useContextMenu outside provider');
  return ctx;
}
