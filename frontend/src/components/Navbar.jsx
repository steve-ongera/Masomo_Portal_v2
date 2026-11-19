// components/Navbar.jsx
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useFullscreen } from "../hooks/useFullscreen";
import { notificationApi, messagingApi } from "../services/api";
import { NAV_BY_ROLE } from "../config/navigation";

const ROLE_LABELS = {
  ADMIN: "Administrator",
  PRINCIPAL: "Principal",
  SECRETARY: "Secretary",
  EXAM_OFFICER: "Exam Officer",
  TEACHER: "Teacher",
  STUDENT: "Student",
  PARENT: "Parent/Guardian",
  FINANCE: "Finance Officer",
  PROCUREMENT: "Procurement Officer",
  LIBRARIAN: "Librarian",
  CAFETERIA: "Cafeteria",
  HR: "HR Officer",
  STAFF: "Staff",
};

const CATEGORY_ICON = {
  GENERAL: "bi-megaphone",
  EVENT: "bi-calendar-event",
  CLOSING: "bi-door-closed",
  FEE_REMINDER: "bi-cash-coin",
  ACADEMIC: "bi-mortarboard",
};

function formatRole(role = "") {
  if (ROLE_LABELS[role]) return ROLE_LABELS[role];
  return role
    .split("_")
    .filter(Boolean)
    .map((w) => w[0] + w.slice(1).toLowerCase())
    .join(" ");
}

function userInitials(user) {
  if (!user) return "?";
  const a = user.first_name?.[0] || user.username?.[0] || "";
  const b = user.last_name?.[0] || "";
  return (a + b).toUpperCase() || "?";
}

const UUID_RE = /^[0-9a-f]{8}(-?[0-9a-f]{4}){3}-?[0-9a-f]{12}$/i;

// Fallback label for URL segments that have no sidebar entry
function crumbLabel(segment) {
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    /* keep raw segment */
  }
  if (UUID_RE.test(decoded)) return decoded.slice(0, 8) + "…";
  if (decoded.length > 20) return decoded.slice(0, 8) + "…";
  return decoded.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function timeAgo(dateString) {
  const seconds = Math.floor((Date.now() - new Date(dateString)) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  return `${days}d ago`;
}

const POLL_INTERVAL_MS = 30000;
const MAX_SUGGESTIONS = 8;

const IS_MAC =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || "");

export default function Navbar({ onToggleSidebar }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen();

  const [openMenu, setOpenMenu] = useState(null); // 'notifications' | 'messages' | 'profile' | null
  const [query, setQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  // Phones (< 768px): the search box is hidden behind an icon button.
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const containerRef = useRef(null);
  const searchRef = useRef(null);
  const inputRef = useRef(null);

  const [notifications, setNotifications] = useState([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [conversations, setConversations] = useState([]);
  const [unreadMessages, setUnreadMessages] = useState(0);

  const refreshCounts = useCallback(() => {
    notificationApi
      .unreadCount()
      .then(({ data }) => setUnreadNotifications(data.unread_count))
      .catch(() => {});
    messagingApi
      .unreadCount()
      .then(({ data }) => setUnreadMessages(data.unread_count))
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshCounts();
    const interval = setInterval(refreshCounts, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refreshCounts]);

  // Flat, ROLE-SCOPED list of every page this user actually has a sidebar
  // link to - this is what the search box is allowed to suggest. Pages are
  // only ever pulled from NAV_BY_ROLE[user.role], so nobody can search their
  // way into a page outside their own section.
  const searchablePages = useMemo(() => {
    const groups = user ? NAV_BY_ROLE[user.role] || [] : [];
    const pages = [];
    groups.forEach((group) => {
      group.items.forEach((item) => {
        pages.push({ ...item, group: group.label || "" });
      });
    });
    return pages;
  }, [user]);

  // Breadcrumbs: labels come from the same nav config as the sidebar, so
  // they always match what the user clicked. A crumb is only a link when it
  // is a real page; folder-like segments (e.g. "finance-reports") are text.
  const { pathname } = useLocation();
  const crumbs = useMemo(() => {
    const segs = pathname.split("/").filter(Boolean);
    if (segs.length === 0) return [{ to: "/", label: "Dashboard", isPage: true }];
    return segs.map((seg, i) => {
      const to = "/" + segs.slice(0, i + 1).join("/");
      const page = searchablePages.find((p) => p.to === to);
      return { to, label: page?.label || crumbLabel(seg), isPage: !!page };
    });
  }, [pathname, searchablePages]);

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return searchablePages
      .filter(
        (p) =>
          p.label.toLowerCase().includes(q) ||
          p.group.toLowerCase().includes(q)
      )
      .slice(0, MAX_SUGGESTIONS);
  }, [query, searchablePages]);

  useEffect(() => {
    setActiveIndex(suggestions.length > 0 ? 0 : -1);
  }, [suggestions]);

  // Close menus + mobile search on every route change
  useEffect(() => {
    setOpenMenu(null);
    setMobileSearchOpen(false);
    setShowSuggestions(false);
  }, [pathname]);

  // Opening the mobile search bar focuses the input straight away
  useEffect(() => {
    if (mobileSearchOpen) {
      // wait a tick so the bar is mounted/visible before focusing
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [mobileSearchOpen]);

  useEffect(() => {
    // pointerdown covers mouse, touch and pen (mousedown is unreliable on phones)
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpenMenu(null);
      }
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setShowSuggestions(false);
        // Tapping outside the phone search bar closes it (unless the tap is
        // on the toggle button, which handles itself).
        if (!e.target.closest?.(".app-navbar__search-toggle")) {
          setMobileSearchOpen(false);
        }
      }
    }
    function handleKeyDown(e) {
      if (e.key === "Escape") {
        setOpenMenu(null);
        setShowSuggestions(false);
        setMobileSearchOpen(false);
      }
      // The search box advertises a shortcut, so make it work
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        if (inputRef.current && inputRef.current.offsetParent !== null) {
          e.preventDefault();
          inputRef.current.focus();
        }
      }
    }
    document.addEventListener("pointerdown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const toggleMenu = (menu) => {
    setOpenMenu((prev) => (prev === menu ? null : menu));
    setMobileSearchOpen(false);
    if (menu === "notifications" && openMenu !== "notifications") {
      notificationApi
        .list({ page_size: 8 })
        .then(({ data }) => setNotifications(data.results ?? data))
        .catch(() => {});
    }
    if (menu === "messages" && openMenu !== "messages") {
      messagingApi
        .conversations()
        .then(({ data }) => setConversations(data.slice(0, 8)))
        .catch(() => {});
    }
  };

  const toggleMobileSearch = () => {
    setOpenMenu(null);
    setMobileSearchOpen((v) => !v);
  };

  const markAllRead = async (e) => {
    e.preventDefault();
    await notificationApi.markAllRead();
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    setUnreadNotifications(0);
  };

  const openNotification = async (n) => {
    if (!n.is_read) {
      await notificationApi.markRead(n.id);
      setNotifications((prev) =>
        prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x))
      );
      setUnreadNotifications((c) => Math.max(0, c - 1));
    }
  };

  const goToPage = (page) => {
    if (!page) return;
    navigate(page.to);
    setQuery("");
    setShowSuggestions(false);
    setMobileSearchOpen(false);
    setActiveIndex(-1);
  };

  const handleSearchChange = (e) => {
    setQuery(e.target.value);
    setShowSuggestions(true);
  };

  const handleSearchKeyDown = (e) => {
    if (!showSuggestions || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      goToPage(suggestions[activeIndex] ?? suggestions[0]);
    }
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    if (suggestions.length > 0) {
      goToPage(suggestions[activeIndex] ?? suggestions[0]);
    }
  };

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const displayName = `${user?.first_name || ""} ${user?.last_name || ""}`.trim() || user?.username;

  return (
    <header className="app-navbar">
      <div className="app-navbar__left">
        <button
          type="button"
          className="app-navbar__toggle"
          onClick={onToggleSidebar}
          aria-label="Toggle menu"
        >
          <i className="bi bi-layout-sidebar" aria-hidden="true"></i>
        </button>

        <nav className="app-navbar__breadcrumbs" aria-label="Breadcrumb">
          {crumbs.map((crumb, i) => {
            const last = i === crumbs.length - 1;
            return (
              <span key={crumb.to} className="app-navbar__crumb">
                {i > 0 && (
                  <i className="bi bi-chevron-right app-navbar__crumb-sep" aria-hidden="true"></i>
                )}
                {last ? (
                  <span className="crumb-text is-current" aria-current="page" title={crumb.label}>
                    {crumb.label}
                  </span>
                ) : crumb.isPage ? (
                  <Link to={crumb.to} title={crumb.label}>{crumb.label}</Link>
                ) : (
                  <span className="crumb-text" title={crumb.label}>{crumb.label}</span>
                )}
              </span>
            );
          })}
        </nav>
      </div>

      {/* Search: inline box on >= 768px; on phones it is a full-width bar
          that drops under the navbar (.is-open) when the search icon is tapped. */}
      <div
        ref={searchRef}
        className={`app-navbar__search-wrap${mobileSearchOpen ? " is-open" : ""}`}
      >
        <form
          className="app-navbar__search"
          onSubmit={handleSearchSubmit}
          autoComplete="off"
          role="search"
        >
          <i className="bi bi-search" aria-hidden="true"></i>
          <input
            ref={inputRef}
            type="text"
            placeholder="Search pages…"
            aria-label="Search pages"
            value={query}
            onChange={handleSearchChange}
            onFocus={() => query.trim() && setShowSuggestions(true)}
            onKeyDown={handleSearchKeyDown}
          />
          <kbd>{IS_MAC ? "⌘ K" : "Ctrl K"}</kbd>
        </form>

        {showSuggestions && query.trim() && (
          <div className="app-navbar__suggest" role="listbox">
            {suggestions.length === 0 ? (
              <div className="app-navbar__dropdown-empty">No matching pages.</div>
            ) : (
              suggestions.map((page, idx) => (
                <div
                  key={page.to}
                  role="option"
                  aria-selected={idx === activeIndex}
                  className={`app-navbar__suggest-item${idx === activeIndex ? " is-active" : ""}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => goToPage(page)}
                  onMouseEnter={() => setActiveIndex(idx)}
                >
                  <i className={`bi ${page.icon}`} aria-hidden="true"></i>
                  <div style={{ minWidth: 0 }}>
                    <div className="app-navbar__suggest-title">{page.label}</div>
                    {page.group && (
                      <div className="app-navbar__suggest-group">{page.group}</div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Right-hand group. Must stay the LAST child of <header>:
          main.css centres the search box using `.app-navbar > :last-child`. */}
      <div ref={containerRef} className="app-navbar__actions">
        {/* Search toggle (phones only - hidden by CSS from 768px up) */}
        <button
          type="button"
          className="app-navbar__icon-btn app-navbar__search-toggle"
          onClick={toggleMobileSearch}
          aria-label={mobileSearchOpen ? "Close search" : "Search pages"}
          aria-expanded={mobileSearchOpen}
        >
          <i
            className={`bi ${mobileSearchOpen ? "bi-x-lg" : "bi-search"}`}
            aria-hidden="true"
          ></i>
        </button>

        {/* Fullscreen toggle (hidden on phones via CSS) */}
        <button
          type="button"
          className="app-navbar__icon-btn app-navbar__fullscreen"
          onClick={toggleFullscreen}
          aria-label={isFullscreen ? "Exit fullscreen" : "Maximize screen"}
          title={isFullscreen ? "Exit fullscreen" : "Maximize screen"}
        >
          <i
            className={`bi ${isFullscreen ? "bi-fullscreen-exit" : "bi-arrows-fullscreen"}`}
            aria-hidden="true"
          ></i>
        </button>

        {/* Notifications */}
        <div className="position-relative">
          <button
            type="button"
            className="app-navbar__icon-btn"
            onClick={() => toggleMenu("notifications")}
            aria-label="Notifications"
            aria-expanded={openMenu === "notifications"}
          >
            <i className="bi bi-bell" aria-hidden="true"></i>
            {unreadNotifications > 0 && (
              <span className="badge-count">{unreadNotifications}</span>
            )}
          </button>

          {openMenu === "notifications" && (
            <div className="app-navbar__dropdown">
              <div className="app-navbar__dropdown-header">
                <span>Notifications</span>
                <div className="d-flex gap-3">
                  <a href="#" onClick={markAllRead}>
                    Mark all read
                  </a>
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      setOpenMenu(null);
                      navigate("/notifications");
                    }}
                  >
                    Open Notifications
                  </a>
                </div>
              </div>
              <div className="app-navbar__dropdown-list">
                {notifications.length === 0 ? (
                  <div className="app-navbar__dropdown-empty">You're all caught up.</div>
                ) : (
                  notifications.map((n) => (
                    <div
                      key={n.id}
                      className={`app-navbar__dropdown-item ${
                        !n.is_read ? "app-navbar__dropdown-item--unread" : ""
                      }`}
                      onClick={() => openNotification(n)}
                      role="button"
                    >
                      <div className="app-navbar__dropdown-avatar">
                        <i className={`bi ${CATEGORY_ICON[n.category] || "bi-bell"}`}></i>
                      </div>
                      <div className="app-navbar__dropdown-body">
                        <div className="app-navbar__dropdown-title">{n.subject}</div>
                        <div className="app-navbar__dropdown-text">{n.body}</div>
                        <div className="app-navbar__dropdown-time">{timeAgo(n.created_at)}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Messages */}
        <div className="position-relative">
          <button
            type="button"
            className="app-navbar__icon-btn"
            onClick={() => toggleMenu("messages")}
            aria-label="Messages"
            aria-expanded={openMenu === "messages"}
          >
            <i className="bi bi-chat-right" aria-hidden="true"></i>
            {unreadMessages > 0 && (
              <span className="badge-count">{unreadMessages}</span>
            )}
          </button>

          {openMenu === "messages" && (
            <div className="app-navbar__dropdown">
              <div className="app-navbar__dropdown-header">
                <span>Messages</span>
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    setOpenMenu(null);
                    navigate("/messages");
                  }}
                >
                  Open Messages
                </a>
              </div>
              <div className="app-navbar__dropdown-list">
                {conversations.length === 0 ? (
                  <div className="app-navbar__dropdown-empty">No messages yet.</div>
                ) : (
                  conversations.map((c) => {
                    const others = (c.participants || []).filter((p) => p.id !== user?.id);
                    const first = others[0];
                    const initials = first
                      ? `${first.first_name?.[0] || ""}${first.last_name?.[0] || ""}`.toUpperCase() || "?"
                      : "?";
                    return (
                      <div
                        key={c.id}
                        className={`app-navbar__dropdown-item ${
                          c.unread_count > 0 ? "app-navbar__dropdown-item--unread" : ""
                        }`}
                        onClick={() => {
                          setOpenMenu(null);
                          navigate("/messages");
                        }}
                        role="button"
                      >
                        <div className="app-navbar__dropdown-avatar">{initials}</div>
                        <div className="app-navbar__dropdown-body">
                          <div className="app-navbar__dropdown-title">
                            {others.map((p) => `${p.first_name} ${p.last_name}`).join(", ") ||
                              "Conversation"}
                          </div>
                          <div className="app-navbar__dropdown-text">{c.last_message?.body || ""}</div>
                          <div className="app-navbar__dropdown-time">
                            {c.last_message ? timeAgo(c.last_message.created_at) : ""}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

        <span className="app-navbar__divider" aria-hidden="true"></span>

        {/* Profile */}
        <div className="position-relative">
          <button
            type="button"
            className="app-navbar__user"
            onClick={() => toggleMenu("profile")}
            aria-haspopup="menu"
            aria-expanded={openMenu === "profile"}
            aria-label="Account menu"
          >
            <span className="app-navbar__avatar">{userInitials(user)}</span>
            <span className="app-navbar__user-info">
              <strong>{displayName}</strong>
              <small>{formatRole(user?.role)}</small>
            </span>
            <i className="bi bi-chevron-down" style={{ fontSize: "0.7rem" }} aria-hidden="true"></i>
          </button>

          {openMenu === "profile" && (
            <div className="app-navbar__dropdown" style={{ width: "14.5rem" }} role="menu">
              <div className="app-navbar__profile-menu">
                {/* Name and role are hidden in the trigger on phones, so repeat them here */}
                <div className="app-navbar__profile-menu-head">
                  <strong>{displayName}</strong>
                  <small>{formatRole(user?.role)}</small>
                </div>
                <div className="app-navbar__profile-menu-divider" />
                <button
                  type="button"
                  role="menuitem"
                  className="app-navbar__profile-menu-item"
                  onClick={() => {
                    setOpenMenu(null);
                    navigate("/profile");
                  }}
                >
                  <i className="bi bi-person"></i>My profile
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="app-navbar__profile-menu-item"
                  onClick={() => {
                    setOpenMenu(null);
                    navigate("/change-password");
                  }}
                >
                  <i className="bi bi-key"></i>Change password
                </button>
                <div className="app-navbar__profile-menu-divider" />
                <button
                  type="button"
                  role="menuitem"
                  className="app-navbar__profile-menu-item app-navbar__profile-menu-item--danger"
                  onClick={handleLogout}
                >
                  <i className="bi bi-box-arrow-right"></i>Logout
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}