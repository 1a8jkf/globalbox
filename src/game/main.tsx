import { createRoot } from "react-dom/client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Polygon } from "geojson";
import { area, polygon } from "@turf/turf";
import { WorldMap, activeMap } from "./Map.tsx";
import { Icon } from "./icons.tsx";
import {
  api,
  type User,
  type Territory,
  type World,
  type Listing,
  type Offer,
  type Quote,
  type Place,
} from "./types.ts";
import {
  BUILDINGS,
  RESOURCE_KINDS,
  CROPS,
  DEFAULT_PRICING,
  estimatePrice,
  money,
  number,
  type PricingConfig,
  type BuildingKind,
  type CropKind,
  type ResourceKind,
} from "../../shared/game.ts";
import { useScreens } from "./screens.ts";
import { visibleWorld, localRegions } from "./remote.ts";
import { WORLD_BOUNDS, type ViewBounds } from "../../shared/contracts.ts";
import type { Panel } from "./screens.ts";
import { CHARACTER_ART, characterArt } from "./characters.ts";
import "./ui.css";

const empty: World = {
  territories: [],
  events: [],
  total: 0,
  players: 0,
  state: { tick: 0, revision: 0 },
};
function App() {
  const {
    top,
    panel,
    setPanel,
    auth,
    setAuth,
    layers,
    setLayers,
    person: personSnapshot,
    setPerson,
    confirmation,
    setConfirmation,
  } = useScreens();
  const [bounds, setBounds] = useState<ViewBounds>(WORLD_BOUNDS),
    [details, setDetails] = useState<Territory[]>([]),
    [resourceLayer, setResourceLayer] = useState(false),
    [collapsed, setCollapsed] = useState(false),
    [textScale, setTextScale] = useState(
      () => Number(localStorage.getItem("gt-text-scale")) || 1,
    );
  const view = useRef(bounds);
  view.current = bounds;
  const socketRef = useRef<WebSocket | null>(null);
  const refreshSerial = useRef(0);
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--text-scale",
      String(textScale),
    );
    localStorage.setItem("gt-text-scale", String(textScale));
  }, [textScale]);

  const [world, setWorld] = useState<World>(empty),
    [user, setUser] = useState<User | null>(null),
    [selected, setSelected] = useState<Territory | null>(null),
    [tab, setTab] = useState("overview"),
    [drawing, setDrawing] = useState(false),
    [draft, setDraft] = useState<Polygon | null>(null),
    [liveArea, setLiveArea] = useState(0),
    [quote, setQuote] = useState<Quote | null>(null),
    [pricing, setPricing] = useState<PricingConfig>(DEFAULT_PRICING),
    [name, setName] = useState("Minha nova terra"),
    [register, setRegister] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [connected, setConnected] = useState(false),
    [ready, setReady] = useState(false),
    [market, setMarket] = useState<Listing[]>([]),
    [offers, setOffers] = useState<Offer[]>([]),
    [owned, setOwned] = useState<Territory[]>([]),
    [political, setPolitical] = useState(true),
    [terrain, setTerrain] = useState(true),
    [population, setPopulation] = useState(false),
    [destination, setDestination] = useState<{
      center: [number, number];
      zoom: number;
      nonce: number;
    } | null>(null),
    [search, setSearch] = useState(""),
    [places, setPlaces] = useState<Place[]>([]),
    [placing, setPlacing] = useState<BuildingKind | null>(null),
    [crop, setCrop] = useState<CropKind>("Wheat"),
    [price, setPrice] = useState("12"),
    [counter, setCounter] = useState<Record<string, string>>({}),
    [profile, setProfile] = useState<{
      username: string;
      createdAt: string;
      territories: Territory[];
      tradingVolume: number;
      trades: number;
    } | null>(null);
  const person =
    selected?.characters?.find((p) => p.id === personSnapshot?.id) ??
    personSnapshot;
  const latest = useRef({
    selected,
    user,
    panel,
    profileName: profile?.username,
  });
  latest.current = { selected, user, panel, profileName: profile?.username };
  const requestSerial = useRef(0);
  const mutation = useRef(false);
  async function refresh() {
    const serial = ++refreshSerial.current,
      current = latest.current;
    const w = await visibleWorld(view.current);
    if (serial !== refreshSerial.current) return;
    setWorld(w);
    const m = activeMap;
    const detailIds = m
      ? w.territories
          .filter((t) => {
            const a = m.project([t.minLon, t.maxLat]),
              b = m.project([t.maxLon, t.minLat]);
            return (
              b.x - a.x > 130 &&
              b.x >= 0 &&
              a.x <= m.getCanvas().clientWidth &&
              b.y >= 0 &&
              a.y <= m.getCanvas().clientHeight
            );
          })
          .map((t) => t.id)
          .slice(0, 24)
      : [];
    const local = await localRegions(detailIds);
    if (serial !== refreshSerial.current) return;
    setDetails(local);

    if (current.selected) {
      const t = await api<Territory>("/territories/" + current.selected.id);
      if (
        serial === refreshSerial.current &&
        latest.current.selected?.id === t.id
      )
        setSelected(t);
    }
    if (current.user) {
      const [me, lands, offers] = await Promise.all([
        api<User>("/me"),
        api<Territory[]>("/me/territories"),
        api<Offer[]>("/me/offers"),
      ]);
      if (
        serial === refreshSerial.current &&
        latest.current.user?.id === current.user.id
      ) {
        setUser(me);
        setOwned(lands);
        setOffers(offers);
      }
    }
    if (current.panel === "market") {
      const listings = await api<Listing[]>("/market");
      if (latest.current.panel === "market" && serial === refreshSerial.current)
        setMarket(listings);
    }
    if (current.panel === "profile" && current.profileName) {
      const next = await api<NonNullable<typeof profile>>(
        "/profiles/" + current.profileName,
      );
      if (
        serial === refreshSerial.current &&
        latest.current.profileName === current.profileName
      )
        setProfile(next);
    }
  }
  async function run(action: () => Promise<void>) {
    if (mutation.current) return;
    mutation.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível concluir.");
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
    void api<User>("/me")
      .then((u) => {
        setUser(u);
        return Promise.all([
          api<Territory[]>("/me/territories").then(setOwned),
          api<Offer[]>("/me/offers").then(setOffers),
        ]);
      })
      .catch(() => {});
    void api<{ pricing: PricingConfig }>("/config")
      .then((c) => setPricing(c.pricing))
      .catch((e) => setError(e.message));
    let ws: WebSocket,
      retry: ReturnType<typeof setTimeout>,
      update: ReturnType<typeof setTimeout>,
      stopped = false,
      inFlight = false;
    const sync = async () => {
      if (inFlight || stopped) return;
      inFlight = true;
      try {
        await refresh();
      } catch {
        setConnected(false);
      } finally {
        inFlight = false;
      }
    };
    function connect() {
      ws = new WebSocket(
        `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`,
      );
      socketRef.current = ws;
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "subscribe", bounds: view.current }));
        setConnected(true);
        void sync();
      };
      ws.onmessage = () => {
        clearTimeout(update);
        update = setTimeout(() => void sync(), 150);
      };
      ws.onerror = () => ws.close();
      ws.onclose = () => {
        setConnected(false);
        if (!stopped) retry = setTimeout(connect, 2000);
      };
    }
    connect();
    const route = () => {
      const match = location.pathname.match(/^\/@([a-z0-9_]+)$/);
      if (match) void showProfile(match[1], false);
    };
    route();
    window.addEventListener("popstate", route);
    return () => {
      stopped = true;
      clearTimeout(retry);
      clearTimeout(update);
      ws.close();
      window.removeEventListener("popstate", route);
    };
  }, []);
  useEffect(() => {
    if (socketRef.current?.readyState === WebSocket.OPEN)
      socketRef.current.send(JSON.stringify({ type: "subscribe", bounds }));
    const timeout = setTimeout(
      () => void refresh().catch((e) => setError(e.message)),
      120,
    );
    return () => clearTimeout(timeout);
  }, [bounds]);
  useEffect(() => {
    if (search.length < 2) {
      setPlaces([]);
      return;
    }
    const timeout = setTimeout(
      () =>
        void api<Place[]>("/search?q=" + encodeURIComponent(search))
          .then(setPlaces)
          .catch(() => {}),
      250,
    );
    return () => clearTimeout(timeout);
  }, [search]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (panel === "market")
      void api<Listing[]>("/market")
        .then(setMarket)
        .catch((e) => setError(e.message));
  }, [panel]);
  const my = !!selected && selected.ownerId === user?.id;
  function fly(t: Territory, zoom?: number) {
    const lon = (t.minLon + t.maxLon) / 2,
      lat = (t.minLat + t.maxLat) / 2,
      span = Math.max(
        t.maxLon - t.minLon,
        (t.maxLat - t.minLat) / Math.cos((lat * Math.PI) / 180),
      );
    const target = Math.max(
      200,
      Math.min(
        innerWidth > 760 ? innerWidth - 600 : innerWidth - 40,
        innerHeight - 220,
      ) * 0.85,
    );
    setDestination({
      center: [
        lon + (innerWidth > 760 ? (t.maxLon - t.minLon) * 0.25 : 0),
        lat - (innerWidth <= 760 ? (t.maxLat - t.minLat) * 0.65 : 0),
      ],
      zoom:
        zoom ??
        Math.max(9, Math.min(17, Math.log2(((360 / span) * target) / 512))),
      nonce: Date.now(),
    });
  }
  async function select(id: string, move = false) {
    const serial = ++requestSerial.current;
    try {
      const t = await api<Territory>("/territories/" + id);
      if (serial !== requestSerial.current) return;
      setSelected(t);
      setPanel(null);
      setTab("overview");
      setPerson(null);
      setPlacing(null);
      setDrawing(false);
      if (move) fly(t);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function showProfile(username: string, push = true) {
    try {
      const p = await api<NonNullable<typeof profile>>("/profiles/" + username);
      setProfile(p);
      setPanel("profile");
      if (push) history.pushState({}, "", `/@${username}`);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function togglePanel(value: Panel) {
    setPanel(panel === value ? null : value);
    setDrawing(false);
    setPlacing(null);
    if (location.pathname !== "/") history.pushState({}, "", "/");
  }
  function beginDraw() {
    if ((activeMap?.getZoom() ?? 0) < 8) {
      setNotice(
        "Aproxime uma região de terra firme para desenhar sua fronteira.",
      );
      setDestination({ center: [-47.65, -22.5], zoom: 12, nonce: Date.now() });
      return;
    }

    if (!user) {
      setAuth(true);
      return;
    }
    setDrawing(true);
    setDraft(null);
    setQuote(null);
    setSelected(null);
    setPanel(null);
    setLiveArea(0);
    setPlacing(null);
    setError("");
  }
  async function finishDraw(geometry: Polygon) {
    setDrawing(false);
    setDraft(geometry);
    setLiveArea(area(polygon(geometry.coordinates)) / 1e6);
    await run(async () => {
      const q = await api<Quote>("/territories/quote", { geometry });
      setQuote(q);
      setDraft(q.geometry);
    });
  }
  async function authenticate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    await run(async () => {
      const u = await api<User>("/auth/" + (register ? "register" : "login"), {
        username: form.get("username"),
        password: form.get("password"),
      });
      setUser(u);
      latest.current.user = u;
      setAuth(false);
      setNotice(
        register
          ? "Seu mundo começa aqui. Você recebeu R$ 100 em saldo fictício."
          : "Bem-vindo de volta.",
      );
    });
  }
  function requireLogin() {
    if (!user) {
      setAuth(true);
      return false;
    }
    return true;
  }
  function buy(l: Listing) {
    if (!requireLogin()) return;
    const requestId = crypto.randomUUID();
    setConfirmation({
      title: "Comprar território",
      text: `Transferir ${l.territory?.name ?? selected?.name} por ${money(l.priceCents)} de saldo fictício?`,
      action: async () => {
        await api("/market/" + l.id + "/buy", { requestId });
        setConfirmation(null);
        setNotice("Compra simulada concluída. O território agora é seu.");
        await select(l.territoryId, true);
      },
    });
  }
  async function order(
    kind: BuildingKind,
    position?: { x: number; y: number },
  ) {
    if (!selected) return;
    await run(async () => {
      await api("/territories/" + selected.id + "/build", {
        type: kind,
        position,
        crop,
        requestId: crypto.randomUUID(),
      });
      setPlacing(null);
      setNotice("Ordem recebida. Os construtores estão a caminho.");
    });
  }
  function priceCents(value: string) {
    const n = Math.round(Number(value.replace(",", ".")) * 100);
    if (!Number.isSafeInteger(n) || n <= 0)
      throw Error("Informe um valor maior que zero.");
    return n;
  }
  const resources = owned.flatMap((t) => t.resources ?? []);
  const totalPeople = owned.reduce(
    (n, t) => n + (t.characters?.length ?? 0),
    0,
  );
  return (
    <div className={"app " + (collapsed ? "panel-collapsed" : "")}>
      <WorldMap
        territories={world.territories}
        details={details}
        resources={resourceLayer}
        blocked={top === "auth" || top === "confirmation"}
        onView={setBounds}
        selected={selected}
        drawing={drawing}
        draft={draft}
        ownerId={user?.id}
        destination={destination}
        political={political}
        terrain={terrain}
        population={population}
        placing={placing}
        onSelect={(id) => void select(id)}
        onDraw={(g) => void finishDraw(g)}
        onArea={setLiveArea}
        onPlace={(x, y) => {
          if (placing) void order(placing, { x, y });
        }}
        onPerson={setPerson}
        onReady={() => setReady(true)}
        onError={setError}
      />
      <header className="topbar">
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            setPanel(null);
            setSelected(null);
            setDestination({
              center: [0, 0],
              zoom: Math.log2(
                Math.min(innerWidth - 36, innerHeight - 140) / 512,
              ),
              nonce: Date.now(),
            });
            history.pushState({}, "", "/");
          }}
        >
          <span className="brand-mark">
            <Icon name="globe" size={27} />
          </span>
          <span>
            GLOBAL <strong>TERRITORY</strong>
            <small>Build your world. Shape your land.</small>
          </span>
        </a>
        <div className="search">
          <Icon name="search" size={18} />
          <input
            aria-label="Buscar localização"
            placeholder="Onde sua história começa?"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <kbd>⌕</kbd>
          {places.length > 0 && (
            <div className="search-results">
              {places.map((p, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setDestination({
                      center: p.coordinates,
                      zoom: 10,
                      nonce: Date.now(),
                    });
                    setSearch("");
                    setPlaces([]);
                  }}
                >
                  <Icon name="flag" size={16} />
                  <span>
                    {p.name}
                    <small>{p.country}</small>
                  </span>
                  <Icon name="arrow" size={15} />
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="account">
          <span
            className={"connection " + (connected ? "online" : "")}
            title={connected ? "Atualizações em tempo real" : "Reconectando"}
          >
            <i />
            {connected ? "Mundo ao vivo" : "Conectando"}
          </span>
          {user ? (
            <>
              <button className="wallet" onClick={() => togglePanel("world")}>
                <Icon name="coin" size={17} />
                {money(user.money)}
                <small>SIMULADO</small>
              </button>
              <button
                className="avatar"
                aria-label="Meu perfil"
                onClick={() => void showProfile(user.username)}
              >
                {user.username.slice(0, 2).toUpperCase()}
              </button>
            </>
          ) : (
            <button className="primary compact" onClick={() => setAuth(true)}>
              Começar <Icon name="arrow" size={16} />
            </button>
          )}
        </div>
      </header>
      <nav className="toolbar" aria-label="Ferramentas do mundo">
        {[
          ["explore", "Explorar", null],
          ["draw", "Desenhar terra", "draw"],
          ["home", "Meu mundo", "world"],
          ["market", "Mercado", "market"],
          ["mail", "Ofertas", "offers"],
          ["activity", "Acontecimentos", "activity"],
        ].map(([icon, label, value]) => (
          <button
            key={icon}
            className={
              (value === "draw" ? drawing : panel === value && value !== null)
                ? "active"
                : ""
            }
            title={label!}
            aria-label={label!}
            onClick={() => {
              if (value === "draw") beginDraw();
              else if (
                (value === "world" || value === "offers") &&
                !requireLogin()
              )
                return;
              else togglePanel(value as Panel);
            }}
          >
            <Icon name={icon!} />
            <span>{label}</span>
            {value === "offers" &&
              offers.some(
                (o) => o.toUserId === user?.id && o.status === "OPEN",
              ) && <b className="notification-dot" />}
          </button>
        ))}
        <div className="tool-divider" />
        <button
          title="Camadas"
          aria-label="Camadas"
          className={layers ? "active" : ""}
          onClick={() => setLayers(!layers)}
        >
          <Icon name="layers" />
          <span>Camadas</span>
        </button>
      </nav>
      {layers && (
        <div className="layer-menu" data-screen="layers">
          <button
            className="icon-button"
            aria-label="Fechar camadas"
            onClick={() => setLayers(false)}
          >
            <Icon name="close" />
          </button>
          <h4>Seu jeito de ver o mundo</h4>
          <label>
            Tamanho do texto
            <select
              aria-label="Tamanho do texto"
              value={textScale}
              onChange={(e) => setTextScale(Number(e.target.value))}
            >
              <option value={1}>Normal</option>
              <option value={1.2}>Grande</option>
              <option value={1.4}>Maior</option>
            </select>
          </label>
          {[
            ["Fronteiras dos jogadores", political, setPolitical],
            ["Biomas e terreno", terrain, setTerrain],
            ["População", population, setPopulation],
            ["Recursos", resourceLayer, setResourceLayer],
          ].map(([label, value, set]) => (
            <label key={String(label)}>
              <input
                type="checkbox"
                checked={value as boolean}
                onChange={(e) =>
                  (set as (b: boolean) => void)(e.target.checked)
                }
              />
              {String(label)}
            </label>
          ))}
        </div>
      )}
      {!selected && !panel && !draft && !drawing && (
        <section className="welcome">
          <div className="eyebrow">
            <span className="tiny-square" /> UM PLANETA. INFINITAS HISTÓRIAS.
          </div>
          <h1>
            O mundo é grande.
            <br />
            Comece com um pedaço.
          </h1>
          <p>
            Desenhe sua fronteira. Cultive uma comunidade.
            <br />
            Construa algo que é só seu.
          </p>
          <button className="primary" onClick={beginDraw}>
            <Icon name="draw" size={18} /> Desenhar meu território{" "}
            <Icon name="arrow" size={17} />
          </button>
          <button
            className="text-button"
            onClick={() => {
              const t = world.territories[0];
              if (t) void select(t.id, true);
              else
                setDestination({
                  center: [-47.5, -22.5],
                  zoom: 10,
                  nonce: Date.now(),
                });
            }}
          >
            Explorar o mundo <Icon name="chevron" size={15} />
          </button>
          <div className="world-stats">
            <div>
              <b>{number(world.total)}</b>
              <small>territórios</small>
            </div>
            <div>
              <b>{number(world.players)}</b>
              <small>contas no mundo</small>
            </div>
            <div>
              <b>{number(world.state.tick)}</b>
              <small>ciclos simulados</small>
            </div>
          </div>
        </section>
      )}
      {(drawing || draft) && (
        <section className="floating-panel claim-panel">
          <div className="panel-heading">
            <span className="eyebrow">SUA PRÓXIMA HISTÓRIA</span>
            <button
              className="icon-button"
              aria-label="Cancelar desenho"
              onClick={() => {
                setDrawing(false);
                setDraft(null);
                setQuote(null);
              }}
            >
              <Icon name="close" />
            </button>
          </div>
          <h2>{drawing ? "Trace sua fronteira." : "Um novo começo."}</h2>
          <p className="muted">
            {drawing
              ? "Arraste sobre terra firme. Solte para fechar sua fronteira."
              : "Uma fronteira livre. Uma comunidade para chamar de sua."}
          </p>
          <div className="claim-measures">
            <div>
              <small>ÁREA {quote ? "VALIDADA" : "ESTIMADA"}</small>
              <b>
                {number(quote?.areaKm2 ?? liveArea)} <em>km²</em>
              </b>
            </div>
            <div>
              <small>{quote ? "PREÇO FINAL" : "ESTIMATIVA"}</small>
              <b>
                {money(quote?.priceCents ?? estimatePrice(liveArea, pricing))}
              </b>
            </div>
          </div>
          <small className="muted">
            Entre {pricing.minArea} e {number(pricing.maxArea)} km² · pelo menos
            80% de terra firme
          </small>
          {draft && (
            <>
              <label className="field">
                Nome do território
                <input
                  maxLength={48}
                  minLength={2}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <button
                className="primary wide"
                disabled={busy || !quote || name.trim().length < 2}
                onClick={() => {
                  if (!quote) return;
                  setConfirmation({
                    title: "Reivindicar território",
                    text: `Comprar ${name} por ${money(quote.priceCents)} de saldo fictício? A cotação é válida por 2 minutos.`,
                    action: async () => {
                      const t = await api<Territory>("/territories/claim", {
                        quoteId: quote.id,
                        name,
                      });
                      setDraft(null);
                      setQuote(null);
                      setConfirmation(null);
                      setSelected(t);
                      fly(t);
                      setNotice(
                        "Sua terra, sua história. Seis moradores chegaram à comunidade.",
                      );
                    },
                  });
                }}
              >
                Simular compra <Icon name="arrow" size={17} />
              </button>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => void finishDraw(draft)}
              >
                Atualizar cotação
              </button>
              <button className="text-button" onClick={beginDraw}>
                Desenhar novamente
              </button>
              <p className="fine-print">
                Somente propriedade virtual. Nenhuma cobrança real.
              </p>
            </>
          )}
        </section>
      )}
      {placing && (
        <div className="placement-hint">
          <Icon name="hammer" /> Clique dentro da sua terra para posicionar{" "}
          {BUILDINGS[placing].label.toLowerCase()}.
          <button
            aria-label="Cancelar posicionamento"
            onClick={() => setPlacing(null)}
          >
            <Icon name="close" size={17} />
          </button>
        </div>
      )}
      {selected && !panel && !draft && !drawing && (
        <aside className="floating-panel territory-panel">
          <div className="panel-heading">
            <span className="eyebrow">
              <Icon name="flag" size={13} /> TERRITÓRIO #
              {selected.number.toString().padStart(4, "0")}
            </span>
            <button
              className="icon-button"
              aria-label="Fechar território"
              onClick={() => {
                setSelected(null);
                setPlacing(null);
                setPerson(null);
              }}
            >
              <Icon name="close" />
            </button>
          </div>
          <h2>{selected.name}</h2>
          <div className="territory-owner">
            <button onClick={() => void showProfile(selected.owner.username)}>
              @{selected.owner.username}
            </button>
            <span className={"pill " + (my ? "green" : "")}>
              {my
                ? "SUA TERRA"
                : selected.listing?.status === "ACTIVE"
                  ? "À VENDA"
                  : selected.owner.username.startsWith("demo_")
                    ? "DEMONSTRAÇÃO"
                    : "COMUNIDADE"}
            </span>
          </div>
          <div className="territory-art">
            <div className="pixel-village">
              <i className="pixel-tree t1" />
              <i className="pixel-tree t2" />
              <i className="pixel-house" />
              <i className="pixel-farm" />
              <i className="pixel-person" />
            </div>
            <span>{number(selected.areaKm2)} km² de possibilidades</span>
            <button className="art-enter" onClick={() => fly(selected)}>
              Explorar <Icon name="arrow" size={15} />
            </button>
          </div>
          <div className="tabs">
            {[
              ["overview", "Visão geral"],
              ["trade", "Negociar"],
              ["build", "Construir"],
              ["people", "Moradores"],
              ["history", "História"],
            ].map(([key, label]) => (
              <button
                key={key}
                className={tab === key ? "active" : ""}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="panel-body">
            {tab === "overview" && (
              <>
                <div className="metrics">
                  <div>
                    <Icon name="people" />
                    <b>{selected.characters?.length ?? 0}</b>
                    <small>moradores</small>
                  </div>
                  <div>
                    <Icon name="home" />
                    <b>
                      {selected.buildings?.filter((b) => b.progress >= 1)
                        .length ?? 0}
                    </b>
                    <small>construções</small>
                  </div>
                  <div>
                    <Icon name="leaf" />
                    <b>{selected.farms?.length ?? 0}</b>
                    <small>plantações</small>
                  </div>
                </div>
                <h4>Recursos da comunidade</h4>
                <div className="resources">
                  {selected.resources
                    ?.slice()
                    .sort(
                      (a, b) =>
                        RESOURCE_KINDS.indexOf(a.kind as ResourceKind) -
                        RESOURCE_KINDS.indexOf(b.kind as ResourceKind),
                    )
                    .map((r) => (
                      <div key={r.kind}>
                        <span>{resourceLabel(r.kind)}</span>
                        <b>
                          {number(r.amount)}
                          <small> / {r.capacity}</small>
                        </b>
                        <div className="resource-track">
                          <i
                            style={{
                              width:
                                Math.min(100, (r.amount / r.capacity) * 100) +
                                "%",
                            }}
                          />
                        </div>
                        <small className="muted">
                          +{number(r.production * 60)} / min
                        </small>
                        {my && (
                          <div className="resource-actions">
                            <button
                              disabled={busy}
                              onClick={() =>
                                void run(async () => {
                                  await api(
                                    "/territories/" + selected.id + "/exchange",
                                    {
                                      kind: r.kind,
                                      side: "buy",
                                      quantity: 20,
                                      requestId: crypto.randomUUID(),
                                    },
                                  );
                                })
                              }
                            >
                              Comprar 20
                            </button>
                            <button
                              disabled={busy || r.amount < 20}
                              onClick={() =>
                                void run(async () => {
                                  await api(
                                    "/territories/" + selected.id + "/exchange",
                                    {
                                      kind: r.kind,
                                      side: "sell",
                                      quantity: 20,
                                      requestId: crypto.randomUUID(),
                                    },
                                  );
                                })
                              }
                            >
                              Vender 20
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                </div>
                <small className="fine-print">
                  Bolsa de recursos com valores simulados configurados pelo
                  servidor. Territórios são negociados entre jogadores.
                </small>
                <button
                  className="primary wide negotiate-entry"
                  onClick={() => setTab("trade")}
                >
                  <Icon name="mail" size={18} />{" "}
                  {my
                    ? "Negociar esta terra"
                    : "Fazer uma oferta ao proprietário"}
                </button>
              </>
            )}
            {tab === "trade" && (
              <>
                <div className="trade-intro">
                  <span className="eyebrow">TERRA COM HISTÓRIA</span>
                  <h3>
                    {my
                      ? "Uma nova história pode começar aqui."
                      : "Gostou deste lugar? Faça uma proposta."}
                  </h3>
                  <p>
                    Você pode negociar qualquer território, mesmo sem anúncio. O
                    proprietário decide se aceita, recusa ou faz uma
                    contraproposta.
                  </p>
                  <span className="pill">Somente dinheiro fictício</span>
                </div>
                {my ? (
                  <div className="commerce">
                    <h4>
                      {selected.listing?.status === "ACTIVE"
                        ? "Seu território está à venda"
                        : "Leve sua história ao mercado"}
                    </h4>
                    <label className="field">
                      Preço de venda (R$ fictícios)
                      <input
                        aria-label="Preço de venda"
                        inputMode="decimal"
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                      />
                    </label>
                    <button
                      className="secondary wide"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await api(
                            "/territories/" + selected.id + "/listing",
                            { priceCents: priceCents(price) },
                          );
                          setNotice("Território anunciado no mercado.");
                        })
                      }
                    >
                      {selected.listing?.status === "ACTIVE"
                        ? "Atualizar preço"
                        : "Anunciar território"}
                    </button>
                    {selected.listing?.status === "ACTIVE" && (
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await api(
                              "/territories/" + selected.id + "/listing",
                              { priceCents: null },
                            );
                          })
                        }
                      >
                        Retirar anúncio
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="commerce">
                    {selected.listing?.status === "ACTIVE" && (
                      <button
                        className="primary wide"
                        onClick={() => buy(selected.listing!)}
                      >
                        Comprar por {money(selected.listing.priceCents)}
                      </button>
                    )}
                    <label className="field">
                      Sua oferta (R$ fictícios)
                      <input
                        aria-label="Valor da oferta"
                        inputMode="decimal"
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                      />
                    </label>
                    <button
                      className="secondary wide"
                      disabled={busy}
                      onClick={() => {
                        if (requireLogin())
                          void run(async () => {
                            await api(
                              "/territories/" + selected.id + "/offers",
                              { amountCents: priceCents(price) },
                            );
                            setNotice(
                              "Oferta enviada. Acompanhe a resposta em Ofertas.",
                            );
                          });
                      }}
                    >
                      Enviar oferta
                    </button>
                  </div>
                )}
                <small className="fine-print">
                  Moradores, construções e estoques acompanham o território. O
                  saldo só é debitado quando a negociação é concluída.
                </small>
                <button
                  className="text-button wide"
                  onClick={() => {
                    if (requireLogin()) setPanel("offers");
                  }}
                >
                  Acompanhar minhas ofertas →
                </button>
              </>
            )}
            {tab === "build" && (
              <>
                {!my && (
                  <p className="muted">
                    Somente o proprietário pode dar ordens nesta comunidade.
                  </p>
                )}
                <label className="field">
                  Cultura das novas fazendas
                  <select
                    value={crop}
                    onChange={(e) => setCrop(e.target.value as CropKind)}
                  >
                    {Object.entries(CROPS).map(([key, v]) => (
                      <option key={key} value={key}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="building-list">
                  {Object.entries(BUILDINGS).map(([key, b]) => (
                    <div className="building-item" key={key}>
                      <span className="building-icon">
                        <Icon name={b.icon} />
                      </span>
                      <div>
                        <b>{b.label}</b>
                        <small>
                          {Object.entries(b.cost)
                            .map(
                              ([k, v]) =>
                                `${v} ${resourceLabel(k).toLowerCase()}`,
                            )
                            .join(" · ")}
                        </small>
                        <div className="inline-actions">
                          <button
                            disabled={!my || busy}
                            onClick={() => void order(key as BuildingKind)}
                          >
                            Dar ordem
                          </button>
                          <button
                            disabled={!my || busy}
                            onClick={() => {
                              setPlacing(key as BuildingKind);
                              fly(selected);
                            }}
                          >
                            Posicionar
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <h4>Em construção</h4>
                {selected.buildings
                  ?.filter((b) => b.progress < 1)
                  .map((b) => (
                    <div className="construction" key={b.id}>
                      <span>{BUILDINGS[b.type as BuildingKind]?.label}</span>
                      <b>{Math.floor(b.progress * 100)}%</b>
                      <progress value={b.progress} max="1" />
                    </div>
                  ))}
                {!selected.buildings?.some((b) => b.progress < 1) && (
                  <p className="muted">
                    Os construtores aguardam sua próxima ideia.
                  </p>
                )}
                {selected.farms?.map((f) => (
                  <div className="construction" key={f.buildingId}>
                    <span>
                      {CROPS[f.crop as CropKind].label} · {f.harvests} colheitas
                    </span>
                    <b>{Math.floor(f.growth * 100)}%</b>
                    <progress value={f.growth} max="1" />
                  </div>
                ))}
              </>
            )}
            {tab === "people" && (
              <>
                <p className="muted">
                  Cada morador tem uma tarefa. Os trabalhadores caminham até o
                  local, constroem, cultivam e descansam.
                </p>
                {selected.characters?.map((p) => (
                  <button
                    key={p.id}
                    className="person-row"
                    onClick={() => setPerson(p)}
                  >
                    <CharacterPortrait profession={p.profession} />
                    <span>
                      <b>{p.name}</b>
                      <small>
                        {professionLabel(p.profession)} · {Math.floor(p.age)}{" "}
                        anos
                      </small>
                    </span>
                    <span className="task-label">{taskLabel(p.task)}</span>
                  </button>
                ))}
              </>
            )}
            {tab === "history" && (
              <>
                <p className="muted">Cada fronteira guarda uma história.</p>
                <div className="timeline">
                  {selected.history?.map((h) => (
                    <div key={h.id}>
                      <small>
                        {new Date(h.createdAt).toLocaleString("pt-BR")}
                      </small>
                      <p>{h.text}</p>
                    </div>
                  ))}
                </div>
                {!!selected.purchases?.length && (
                  <>
                    <h4>Histórico de valores simulados</h4>
                    <div className="price-history">
                      {selected.purchases.map((p, i) => (
                        <span key={i}>
                          {money(p.amountCents)}
                          {i < selected.purchases!.length - 1 ? " → " : ""}
                        </span>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </aside>
      )}
      {panel && (
        <aside className="floating-panel large-panel" data-screen="panel">
          <div className="panel-heading">
            <span className="eyebrow">GLOBAL TERRITORY</span>
            <button
              className="icon-button"
              aria-label="Fechar painel"
              onClick={() => setPanel(null)}
            >
              <Icon name="close" />
            </button>
          </div>
          <h2>
            {
              {
                world: "Meu mundo",
                market: "Um mundo de oportunidades.",
                activity: "O mundo continua.",
                offers: "Vamos conversar.",
                profile: "@" + profile?.username,
              }[panel]
            }
          </h2>
          <p className="muted">
            {
              {
                world: "Pequenas comunidades. Grandes possibilidades.",
                market: "Encontre uma terra com uma história para continuar.",
                activity:
                  "Histórias escritas por comunidades de todo o planeta.",
                offers: "Ofertas e contrapropostas para seus territórios.",
                profile: "As marcas de um explorador no mundo.",
              }[panel]
            }
          </p>
          <div className="panel-body">
            {panel === "world" && (
              <>
                <div className="dashboard-numbers">
                  <div>
                    <b>{owned.length}</b>
                    <small>Territórios</small>
                  </div>
                  <div>
                    <b>{totalPeople}</b>
                    <small>Moradores</small>
                  </div>
                  <div>
                    <b>
                      {owned.reduce(
                        (n, t) => n + (t.buildings?.length ?? 0),
                        0,
                      )}
                    </b>
                    <small>Construções</small>
                  </div>
                  <div>
                    <b>{money(user?.money ?? 0)}</b>
                    <small>Saldo fictício</small>
                  </div>
                </div>
                <div className="resource-summary">
                  {(
                    [
                      "Food",
                      "Wood",
                      "Stone",
                      "Metal",
                      "Energy",
                    ] as ResourceKind[]
                  ).map((k) => (
                    <span key={k}>
                      {resourceLabel(k)}{" "}
                      <b>
                        {number(
                          resources
                            .filter((r) => r.kind === k)
                            .reduce((n, r) => n + r.amount, 0),
                        )}
                      </b>
                    </span>
                  ))}
                </div>
                <h4>Suas terras</h4>
                {owned.map((t) => (
                  <TerritoryCard
                    key={t.id}
                    t={t}
                    onClick={() => void select(t.id, true)}
                  />
                ))}
                {!owned.length && (
                  <Empty
                    icon="flag"
                    title="Sua história ainda está por começar."
                    text="Encontre um lugar no mapa e desenhe sua própria fronteira."
                  />
                )}
                <button className="primary wide" onClick={beginDraw}>
                  <Icon name="draw" /> Desenhar novo território
                </button>
              </>
            )}
            {panel === "market" && (
              <>
                <div className="market-note">
                  <Icon name="coin" />
                  <span>
                    Todos os valores são fictícios.
                    <br />
                    <small>
                      Compras transferem a propriedade dentro do jogo.
                    </small>
                  </span>
                </div>
                {market.map((l) => (
                  <article key={l.id} className="market-card">
                    <div className="mini-land">
                      <Icon name="tree" size={36} />
                      <Icon name="home" size={28} />
                      <span>{number(l.territory.areaKm2)} km²</span>
                    </div>
                    <div className="market-info">
                      <small>
                        TERRITÓRIO #{l.territory.number}{" "}
                        {l.territory.owner.username.startsWith("demo_")
                          ? "· DEMONSTRAÇÃO"
                          : ""}
                      </small>
                      <h3>{l.territory.name}</h3>
                      <p>
                        @{l.territory.owner.username} ·{" "}
                        {l.territory._count?.characters} moradores
                      </p>
                      <div>
                        <strong>{money(l.priceCents)}</strong>
                        <button
                          className="text-button"
                          onClick={() => void select(l.territoryId, true)}
                        >
                          Conhecer <Icon name="arrow" size={16} />
                        </button>
                      </div>
                      {l.sellerId !== user?.id && (
                        <button
                          className="secondary wide"
                          disabled={busy}
                          onClick={() => buy(l)}
                        >
                          Comprar território
                        </button>
                      )}
                    </div>
                  </article>
                ))}
                {!market.length && (
                  <Empty
                    icon="market"
                    title="O próximo anúncio pode ser seu."
                    text="Abra um território seu para definir um preço de venda."
                  />
                )}
              </>
            )}
            {panel === "activity" && (
              <div className="timeline">
                {world.events.map((e) => (
                  <div key={e.id}>
                    <small>
                      {new Date(e.createdAt).toLocaleString("pt-BR")}
                    </small>
                    <button onClick={() => void select(e.territoryId, true)}>
                      {e.text}
                    </button>
                  </div>
                ))}
                {!world.events.length && (
                  <Empty
                    icon="activity"
                    title="Um mundo esperando por histórias."
                    text="Novas comunidades e construções aparecerão aqui."
                  />
                )}
              </div>
            )}
            {panel === "offers" && (
              <>
                {offers.map((o) => (
                  <div className="offer-card" key={o.id}>
                    <span className="pill">{statusLabel(o.status)}</span>
                    <h3>{o.territory.name}</h3>
                    <p>
                      @{o.from} → @{o.to}
                    </p>
                    <strong>{money(o.amountCents)}</strong>
                    <button
                      className="text-button"
                      onClick={() => void select(o.territoryId, true)}
                    >
                      Ver território <Icon name="arrow" size={15} />
                    </button>
                    {o.status === "OPEN" && o.toUserId === user?.id && (
                      <>
                        <div className="two-buttons">
                          <button
                            className="primary"
                            disabled={busy}
                            onClick={() =>
                              setConfirmation({
                                title: "Aceitar negociação",
                                text: `Confirmar a transferência deste território por ${money(o.amountCents)} fictícios?`,
                                action: async () => {
                                  await api("/offers/" + o.id + "/respond", {
                                    action: "accept",
                                  });
                                  setConfirmation(null);
                                  setNotice("Negociação concluída.");
                                },
                              })
                            }
                          >
                            Aceitar
                          </button>
                          <button
                            className="secondary"
                            disabled={busy}
                            onClick={() =>
                              void run(async () => {
                                await api("/offers/" + o.id + "/respond", {
                                  action: "reject",
                                });
                              })
                            }
                          >
                            Recusar
                          </button>
                        </div>
                        <label className="field">
                          Contraproposta (R$ fictícios)
                          <input
                            value={counter[o.id] ?? ""}
                            inputMode="decimal"
                            onChange={(e) =>
                              setCounter({ ...counter, [o.id]: e.target.value })
                            }
                          />
                        </label>
                        <button
                          className="secondary wide"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await api("/offers/" + o.id + "/respond", {
                                action: "counter",
                                amountCents: priceCents(counter[o.id] ?? ""),
                              });
                            })
                          }
                        >
                          Enviar contraproposta
                        </button>
                      </>
                    )}
                  </div>
                ))}
                {!offers.length && (
                  <Empty
                    icon="mail"
                    title="Boas histórias começam com uma conversa."
                    text="Envie uma oferta a outro proprietário ou anuncie uma terra sua."
                  />
                )}
              </>
            )}
            {panel === "profile" && profile && (
              <>
                <div className="profile-heading">
                  <span className="profile-avatar">
                    {profile.username.slice(0, 2).toUpperCase()}
                  </span>
                  <div>
                    <h3>@{profile.username}</h3>
                    <small>
                      Explorador desde{" "}
                      {new Date(profile.createdAt).toLocaleDateString("pt-BR")}
                    </small>
                  </div>
                </div>
                <div className="dashboard-numbers">
                  <div>
                    <b>{profile.territories.length}</b>
                    <small>Territórios</small>
                  </div>
                  <div>
                    <b>
                      {profile.territories.reduce(
                        (n, t) => n + (t._count?.characters ?? 0),
                        0,
                      )}
                    </b>
                    <small>Moradores</small>
                  </div>
                  <div>
                    <b>{money(profile.tradingVolume)}</b>
                    <small>Volume fictício</small>
                  </div>
                  <div>
                    <b>{profile.trades}</b>
                    <small>Transações</small>
                  </div>
                </div>
                {profile.territories.map((t) => (
                  <TerritoryCard
                    key={t.id}
                    t={t}
                    onClick={() => void select(t.id, true)}
                  />
                ))}
                {user?.username === profile.username && (
                  <button
                    className="text-button"
                    onClick={() =>
                      void run(async () => {
                        await api("/auth/logout", {});
                        setUser(null);
                        latest.current.user = null;
                        setOwned([]);
                        setOffers([]);
                        setPanel(null);
                      })
                    }
                  >
                    <Icon name="logout" size={16} /> Sair da conta
                  </button>
                )}
              </>
            )}
          </div>
        </aside>
      )}
      {person && (
        <div className="person-detail" data-screen="person">
          <button
            className="icon-button"
            aria-label="Fechar morador"
            onClick={() => setPerson(null)}
          >
            <Icon name="close" />
          </button>
          <CharacterPortrait profession={person.profession} />
          <h3>{person.name}</h3>
          <p>
            {professionLabel(person.profession)} · {taskLabel(person.task)}
          </p>
          <p className="character-description">
            {CHARACTER_ART[characterArt(person.profession)].description}
          </p>
          {[
            ["Saúde", person.health],
            ["Energia", person.energy],
            ["Fome", person.hunger],
          ].map(([label, value]) => (
            <label key={label}>
              {label}
              <progress max="100" value={value} />
            </label>
          ))}
        </div>
      )}
      {(selected || panel) && (
        <button
          className="sheet-toggle"
          aria-label={collapsed ? "Expandir painel" : "Recolher painel"}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? "Abrir detalhes" : "Recolher detalhes"}{" "}
          <Icon name="chevron" size={16} />
        </button>
      )}
      <footer className="statusbar">
        <span>
          <i className={connected ? "live-dot" : "offline-dot"} />
          {ready
            ? "Um mundo compartilhado, uma história de cada vez."
            : "Preparando seu planeta…"}
        </span>
        <span>
          Arraste para explorar <b>·</b> Role para aproximar <b>·</b> Home:
          planeta
        </span>
        <span className="version">ALPHA 0.2</span>
      </footer>
      {(error || notice) && (
        <div
          className={"toast " + (error ? "error" : "")}
          role={error ? "alert" : "status"}
        >
          <Icon name={error ? "flag" : "leaf"} size={19} />
          <span>{error || notice}</span>
          <button
            aria-label="Fechar aviso"
            onClick={() => {
              setError("");
              setNotice("");
            }}
          >
            <Icon name="close" size={18} />
          </button>
        </div>
      )}
      {auth && (
        <div className="modal-backdrop">
          <section className="modal" data-screen="auth">
            <button
              className="icon-button modal-close"
              aria-label="Fechar login"
              onClick={() => setAuth(false)}
            >
              <Icon name="close" />
            </button>
            <span className="brand-mark large">
              <Icon name="globe" size={34} />
            </span>
            <div className="eyebrow">UM PEQUENO COMEÇO. UM GRANDE MUNDO.</div>
            <h2>
              {register
                ? "Sua próxima história começa aqui."
                : "Seu mundo espera por você."}
            </h2>
            <p className="muted">
              {register
                ? "Crie sua conta e receba R$ 100 de saldo fictício para explorar."
                : "Entre para cuidar das suas terras e comunidades."}
            </p>
            <form onSubmit={(e) => void authenticate(e)}>
              <label className="field">
                Nome de explorador
                <input
                  data-initial-focus
                  name="username"
                  autoComplete="username"
                  required
                  pattern="[a-zA-Z][a-zA-Z0-9_]{2,19}"
                  maxLength={20}
                  placeholder="seu_nome"
                />
              </label>
              <label className="field">
                Senha
                <input
                  name="password"
                  type="password"
                  autoComplete={register ? "new-password" : "current-password"}
                  required
                  minLength={8}
                  maxLength={128}
                  placeholder="Pelo menos 8 caracteres"
                />
              </label>
              <button className="primary wide" disabled={busy}>
                {busy
                  ? "Preparando…"
                  : register
                    ? "Criar minha conta"
                    : "Entrar no meu mundo"}
                <Icon name="arrow" size={17} />
              </button>
            </form>
            <button
              className="text-button"
              onClick={() => setRegister(!register)}
            >
              {register ? "Já tenho uma conta" : "Quero criar uma conta"}
            </button>
            <p className="fine-print">
              Um jogo de propriedade virtual. Pagamentos sempre simulados.
            </p>
          </section>
        </div>
      )}
      {confirmation && (
        <div className="modal-backdrop">
          <section className="modal" data-screen="confirmation">
            <div className="eyebrow">PAGAMENTO SIMULADO</div>
            <h2>{confirmation.title}</h2>
            <p>{confirmation.text}</p>
            <div className="two-buttons">
              <button
                className="secondary"
                disabled={busy}
                onClick={() => setConfirmation(null)}
              >
                Cancelar
              </button>
              <button
                className="primary"
                disabled={busy}
                onClick={() => void run(confirmation.action)}
              >
                {busy ? "Confirmando…" : "Confirmar"}
              </button>
            </div>
            <p className="fine-print">Nenhum dinheiro real será cobrado.</p>
          </section>
        </div>
      )}
    </div>
  );
}
function resourceLabel(k: string) {
  return (
    (
      {
        Food: "Alimento",
        Wood: "Madeira",
        Stone: "Pedra",
        Metal: "Metal",
        Energy: "Energia",
      } as Record<string, string>
    )[k] ?? k
  );
}
function professionLabel(k: string) {
  return (
    (
      {
        Builder: "Construtor",
        Farmer: "Agricultor",
        Woodcutter: "Lenhador",
        Miner: "Minerador",
      } as Record<string, string>
    )[k] ?? k
  );
}
function taskLabel(k: string) {
  return (
    (
      {
        Exploring: "Explorando",
        Walking: "A caminho",
        Building: "Construindo",
        Farming: "Cultivando",
        Gathering: "Coletando",
        Mining: "Minerando",
        Resting: "Descansando",
        Eating: "Comendo",
      } as Record<string, string>
    )[k] ?? k
  );
}
function statusLabel(k: string) {
  return (
    (
      {
        OPEN: "EM NEGOCIAÇÃO",
        ACCEPTED: "ACEITA",
        REJECTED: "RECUSADA",
        COUNTERED: "CONTRAPROPOSTA",
        INVALIDATED: "ENCERRADA",
      } as Record<string, string>
    )[k] ?? k
  );
}
function Empty({
  icon,
  title,
  text,
}: {
  icon: string;
  title: string;
  text: string;
}) {
  return (
    <div className="empty">
      <Icon name={icon} size={35} />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
function TerritoryCard({ t, onClick }: { t: Territory; onClick: () => void }) {
  return (
    <button className="territory-card" onClick={onClick}>
      <span className="land-icon">
        <Icon name="tree" size={27} />
      </span>
      <span>
        <b>{t.name}</b>
        <small>
          {number(t.areaKm2)} km² · #{t.number}
        </small>
      </span>
      <Icon name="arrow" size={18} />
    </button>
  );
}
createRoot(document.getElementById("root")!).render(<App />);

function CharacterPortrait({ profession }: { profession: string }) {
  const role = characterArt(profession);
  return (
    <span
      className="character-portrait"
      aria-hidden="true"
      style={{
        backgroundImage: `url(/characters/${role}.png)`,
        backgroundPosition: `${-CHARACTER_ART[role].idle * 80}px 0`,
      }}
    />
  );
}
