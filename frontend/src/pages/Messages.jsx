import { useEffect, useRef, useState } from "react";
import { messagingApi } from "../services/api";
import { useAuth } from "../hooks/useAuth";

const STAFF_ROLES = ["ADMIN", "TEACHER", "FINANCE", "PRINCIPAL", "SECRETARY"];

const ROLE_BADGE = {
  STUDENT: "badge-blue",
  PARENT: "badge-gold",
  TEACHER: "badge-success",
  ADMIN: "badge-danger",
  FINANCE: "badge-neutral",
};

const ROLE_ICON = {
  STUDENT: "bi-person",
  PARENT: "bi-people",
  TEACHER: "bi-person-workspace",
  ADMIN: "bi-shield-lock",
  FINANCE: "bi-cash-stack",
};

export default function Messages() {
  const { user } = useAuth();
  const canStartConversation = STAFF_ROLES.includes(user?.role);

  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [thread, setThread] = useState([]);
  const [draft, setDraft] = useState("");
  const [loadingThread, setLoadingThread] = useState(false);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const bottomRef = useRef(null);

  // new conversation composer
  const [composing, setComposing] = useState(false);
  const [recipientSearch, setRecipientSearch] = useState("");
  const [recipientResults, setRecipientResults] = useState([]);
  const [selectedRecipient, setSelectedRecipient] = useState(null);
  const [firstMessage, setFirstMessage] = useState("");
  const [starting, setStarting] = useState(false);
  const [searchingRecipients, setSearchingRecipients] = useState(false);

  const loadConversations = async () => {
    try {
      const { data } = await messagingApi.conversations();
      setConversations(data.results ?? data);
    } catch (error) {
      console.error("Failed to load conversations:", error);
    } finally {
      setLoadingConversations(false);
    }
  };

  useEffect(() => {
    loadConversations();
  }, []);

  useEffect(() => {
    if (!recipientSearch.trim()) {
      setRecipientResults([]);
      return;
    }
    setSearchingRecipients(true);
    const t = setTimeout(() => {
      messagingApi.searchRecipients({ search: recipientSearch })
        .then(({ data }) => setRecipientResults(data.results ?? data))
        .finally(() => setSearchingRecipients(false));
    }, 350);
    return () => clearTimeout(t);
  }, [recipientSearch]);

  const openConversation = async (id) => {
    setActiveId(id);
    setComposing(false);
    setLoadingThread(true);
    try {
      const { data } = await messagingApi.messages(id);
      setThread(data.results ?? data);
      loadConversations();
    } finally {
      setLoadingThread(false);
    }
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [thread]);

  const sendReply = async (e) => {
    e.preventDefault();
    if (!draft.trim() || !activeId) return;
    const { data } = await messagingApi.send(activeId, draft.trim());
    setThread((prev) => [...prev, data]);
    setDraft("");
    loadConversations();
  };

  const startConversation = async (e) => {
    e.preventDefault();
    if (!selectedRecipient || !firstMessage.trim()) return;
    setStarting(true);
    try {
      const { data } = await messagingApi.start({
        recipient_id: selectedRecipient.user_id,
        student_id: selectedRecipient.student_id || null,
        body: firstMessage.trim(),
      });
      setFirstMessage("");
      setSelectedRecipient(null);
      setRecipientSearch("");
      setComposing(false);
      await loadConversations();
      openConversation(data.id);
    } finally {
      setStarting(false);
    }
  };

  const otherParticipants = (conv) => (conv.participants || []).filter((p) => p.id !== user?.id);

  const getInitials = (firstName, lastName) => {
    return `${firstName?.[0] || ''}${lastName?.[0] || ''}` || "?";
  };

  const formatTime = (dateStr) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString('en-KE', { month: 'short', day: 'numeric' });
  };

  return (
    <div>
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Messages</h1>
          <p className="page-subtitle">
            Communicate with teachers, parents, and staff
          </p>
        </div>
        {canStartConversation && !composing && (
          <div className="page-header__actions">
            <button className="btn btn-primary btn-sm" onClick={() => setComposing(true)}>
              <i className="bi bi-plus-lg"></i>
              New Message
            </button>
          </div>
        )}
      </div>

      <div className="row g-3" style={{ minHeight: "65vh" }}>
        {/* ---- Conversation List ---- */}
        <div className="col-12 col-md-4">
          <div className="card h-100 d-flex flex-column overflow-hidden">
            <div className="card-header">
              <span className="chart-card__title mb-0">
                <i className="bi bi-chat-dots me-2 text-brand"></i>
                Conversations
                {conversations.length > 0 && (
                  <span className="badge badge-neutral ms-2">{conversations.length}</span>
                )}
              </span>
            </div>

            <div className="flex-grow-1 overflow-auto" style={{ maxHeight: "60vh" }}>
              {loadingConversations ? (
                <div className="pick-list p-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="d-flex gap-3 py-2 border-bottom">
                      <div className="skeleton skeleton-avatar"></div>
                      <div className="flex-grow-1">
                        <div className="skeleton skeleton-text" style={{ width: "60%", height: "16px" }}></div>
                        <div className="skeleton skeleton-text mt-1" style={{ width: "80%", height: "12px" }}></div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : conversations.length === 0 ? (
                <div className="empty-state">
                  <i className="bi bi-chat-dots"></i>
                  <h6>No conversations</h6>
                  <p className="text-muted-soft">
                    {canStartConversation ? "Start a new conversation" : "Messages will appear here"}
                  </p>
                </div>
              ) : (
                <div className="pick-list p-2">
                  {conversations.map((conv) => {
                    const others = otherParticipants(conv);
                    const other = others[0];
                    const isActive = activeId === conv.id;

                    return (
                      <button
                        key={conv.id}
                        type="button"
                        onClick={() => openConversation(conv.id)}
                        className={`pick-item ${isActive ? "is-selected" : ""}`}
                      >
                        <div className={`avatar-sm ${isActive ? "bg-brand text-white" : ""}`}>
                          {other ? getInitials(other.first_name, other.last_name) : "?"}
                        </div>
                        <div className="min-w-0 flex-grow-1">
                          <div className="d-flex justify-content-between align-items-center">
                            <strong className={`text-truncate ${isActive ? "text-brand" : ""}`}>
                              {others.map((p) => `${p.first_name} ${p.last_name}`).join(", ") || "Conversation"}
                            </strong>
                            {conv.unread_count > 0 && (
                              <span className="badge badge-danger ms-2 flex-shrink-0">
                                {conv.unread_count}
                              </span>
                            )}
                          </div>
                          {conv.student_name && (
                            <div className="small text-brand mt-1">
                              <i className="bi bi-person me-1"></i>
                              {conv.student_name}
                            </div>
                          )}
                          {conv.last_message && (
                            <div className="text-truncate small text-muted-soft mt-1">
                              {conv.last_message.body}
                            </div>
                          )}
                          {conv.last_message && (
                            <div className="text-muted-soft mt-1" style={{ fontSize: "0.65rem" }}>
                              <i className="bi bi-clock me-1"></i>
                              {formatTime(conv.last_message.created_at)}
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ---- Thread / Composer ---- */}
        <div className="col-12 col-md-8">
          <div className="card h-100 d-flex flex-column overflow-hidden">
            {/* Compose New Message */}
            {composing && (
              <div className="card-body">
                <h5 className="panel-title mb-3">
                  <i className="bi bi-pencil-square text-brand"></i>
                  New Message
                </h5>
                <form onSubmit={startConversation}>
                  {!selectedRecipient ? (
                    <>
                      <label className="form-label">
                        <i className="bi bi-person-plus me-1 text-brand"></i>
                        To (student or parent/guardian)
                      </label>
                      <div className="toolbar__search mb-2" style={{ maxWidth: "none" }}>
                        <i className="bi bi-search"></i>
                        <input
                          className="form-control"
                          placeholder="Search by name or admission no..."
                          value={recipientSearch}
                          onChange={(e) => setRecipientSearch(e.target.value)}
                          autoFocus
                        />
                      </div>

                      {searchingRecipients && (
                        <div className="text-center py-3">
                          <div className="spinner-border spinner-border-sm text-primary" role="status"></div>
                        </div>
                      )}

                      {!searchingRecipients && recipientResults.length > 0 && (
                        <div className="pick-list" style={{ maxHeight: "300px", overflowY: "auto" }}>
                          {recipientResults.map((r) => (
                            <button
                              type="button"
                              key={`${r.role}-${r.user_id}`}
                              onClick={() => setSelectedRecipient(r)}
                              className="pick-item"
                            >
                              <div className="avatar-sm">
                                {getInitials(r.name?.split(' ')[0], r.name?.split(' ')[1])}
                              </div>
                              <div className="min-w-0 flex-grow-1">
                                <div className="d-flex align-items-center gap-2">
                                  <strong>{r.name}</strong>
                                  <span className={`badge ${ROLE_BADGE[r.role] || "badge-neutral"}`}>
                                    <i className={`bi ${ROLE_ICON[r.role] || "bi-person"} me-1`}></i>
                                    {r.role}
                                  </span>
                                </div>
                                <div className="small text-muted-soft mt-1">
                                  {r.detail}
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}

                      {!searchingRecipients && recipientSearch.trim() && recipientResults.length === 0 && (
                        <div className="empty-state py-3">
                          <i className="bi bi-search"></i>
                          <p className="text-muted-soft mt-2 mb-0">
                            No recipients found for "{recipientSearch}"
                          </p>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="pay-student">
                        <div className="d-flex align-items-center gap-3">
                          <div className="avatar-sm">
                            {getInitials(selectedRecipient.name?.split(' ')[0], selectedRecipient.name?.split(' ')[1])}
                          </div>
                          <div>
                            <div className="d-flex align-items-center gap-2">
                              <strong>{selectedRecipient.name}</strong>
                              <span className={`badge ${ROLE_BADGE[selectedRecipient.role] || "badge-neutral"}`}>
                                {selectedRecipient.role}
                              </span>
                            </div>
                            <div className="small text-muted-soft">
                              {selectedRecipient.detail}
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-secondary"
                          onClick={() => setSelectedRecipient(null)}
                        >
                          <i className="bi bi-arrow-repeat me-1"></i>
                          Change
                        </button>
                      </div>

                      <label className="form-label">
                        <i className="bi bi-chat-text me-1 text-brand"></i>
                        Message
                      </label>
                      <textarea
                        className="form-control mb-3"
                        rows={4}
                        required
                        placeholder="Type your message here..."
                        value={firstMessage}
                        onChange={(e) => setFirstMessage(e.target.value)}
                        autoFocus
                      />

                      <div className="d-flex gap-2">
                        <button className="btn btn-primary" disabled={starting || !firstMessage.trim()}>
                          {starting ? (
                            <>
                              <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                              Sending...
                            </>
                          ) : (
                            <>
                              <i className="bi bi-send me-2"></i>
                              Send
                            </>
                          )}
                        </button>
                        <button type="button" className="btn btn-outline-secondary" onClick={() => setComposing(false)}>
                          Cancel
                        </button>
                      </div>
                    </>
                  )}
                </form>
              </div>
            )}

            {/* Empty State - No Active Conversation */}
            {!composing && !activeId && (
              <div className="empty-state flex-grow-1 d-flex flex-column justify-content-center py-5">
                <i className="bi bi-chat-dots"></i>
                <h6>No conversation selected</h6>
                <p className="text-muted-soft">
                  Select a conversation from the list, or start a new one.
                </p>
                {canStartConversation && (
                  <button className="btn btn-primary btn-sm mt-2" onClick={() => setComposing(true)}>
                    <i className="bi bi-plus-lg me-1"></i>
                    New Message
                  </button>
                )}
              </div>
            )}

            {/* Active Thread */}
            {!composing && activeId && (
              <>
                {/* Thread Header */}
                <div className="card-header d-flex align-items-center gap-3">
                  {(() => {
                    const conv = conversations.find(c => c.id === activeId);
                    const others = conv ? otherParticipants(conv) : [];
                    const other = others[0];
                    return (
                      <>
                        <div className="avatar-sm">
                          {other ? getInitials(other.first_name, other.last_name) : "?"}
                        </div>
                        <div className="flex-grow-1 min-w-0">
                          <strong className="chart-card__title d-block mb-0">
                            {others.map((p) => `${p.first_name} ${p.last_name}`).join(", ") || "Conversation"}
                          </strong>
                          {conv?.student_name && (
                            <div className="small text-brand">
                              <i className="bi bi-person me-1"></i>
                              Re: {conv.student_name}
                            </div>
                          )}
                        </div>
                      </>
                    );
                  })()}
                </div>

                {/* Messages */}
                <div
                  className="card-body flex-grow-1 bg-brand-50"
                  style={{ overflowY: "auto", maxHeight: "50vh" }}
                >
                  {loadingThread ? (
                    <div className="text-center py-4">
                      <div className="spinner-border spinner-border-sm text-primary" role="status"></div>
                    </div>
                  ) : thread.length === 0 ? (
                    <div className="empty-state">
                      <i className="bi bi-chat"></i>
                      <h6>No messages yet</h6>
                      <p className="text-muted-soft">
                        Send the first message below.
                      </p>
                    </div>
                  ) : (
                    thread.map((m) => {
                      const mine = m.sender === user?.id;
                      return (
                        <div key={m.id} className={`d-flex mb-3 ${mine ? "justify-content-end" : "justify-content-start"}`}>
                          {!mine && (
                            <div className="avatar-xs me-2 align-self-end flex-shrink-0">
                              {getInitials(m.sender_name?.split(' ')[0], m.sender_name?.split(' ')[1])}
                            </div>
                          )}
                          <div className={`message-bubble ${mine ? "message-bubble--mine" : "message-bubble--theirs"}`}>
                            {!mine && (
                              <div className="message-bubble__sender">
                                {m.sender_name}
                              </div>
                            )}
                            <div className="message-bubble__body">{m.body}</div>
                            <div className={`message-bubble__time ${mine ? "text-end" : ""}`}>
                              {new Date(m.created_at).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={bottomRef} />
                </div>

                {/* Reply Form */}
                <form
                  className="card-footer"
                  style={{ padding: "0.75rem 1rem" }}
                  onSubmit={sendReply}
                >
                  <div className="d-flex gap-2">
                    <input
                      className="form-control rounded-pill"
                      placeholder="Type a message..."
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                    />
                    <button
                      className="btn btn-primary rounded-pill px-4"
                      disabled={!draft.trim()}
                    >
                      <i className="bi bi-send me-1"></i>
                      Send
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}