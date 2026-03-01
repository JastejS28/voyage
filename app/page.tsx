"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import JourneyBackground from "@/components/JourneyBackground";
import {
    Upload,
    Search,
    Sparkles,
    RefreshCw,
    Radio,
    User,
    X,
    Menu,
    ArrowRight,
    Play,
    Paperclip,
    Send,
    CheckCircle,
    Waves,
    TreePalm,
    Landmark,
    Sunset,
    Twitter,
    Linkedin,
    Github,
} from "lucide-react";

/* ────────── stat counter hook ────────── */
function useCountUp(end: number, duration: number = 2000): {
    count: number;
    ref: React.RefObject<HTMLDivElement | null>;
} {
    const [count, setCount] = useState<number>(0);
    const ref = useRef<HTMLDivElement>(null);
    const started = useRef<boolean>(false);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;

        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting && !started.current) {
                    started.current = true;
                    const startTime = performance.now();
                    const animate = (now: number): void => {
                        const elapsed = now - startTime;
                        const progress = Math.min(elapsed / duration, 1);
                        const eased = 1 - Math.pow(1 - progress, 5);
                        setCount(Math.floor(eased * end));
                        if (progress < 1) requestAnimationFrame(animate);
                    };
                    requestAnimationFrame(animate);
                }
            },
            { threshold: 0.3 }
        );

        observer.observe(el);
        return () => observer.disconnect();
    }, [end, duration]);

    return { count, ref };
}

/* ────────── scroll reveal hook ────────── */
function useScrollReveal(): void {
    useEffect(() => {
        const handleIntersect = (entries: IntersectionObserverEntry[]) => {
            entries.forEach((e) => {
                if (e.isIntersecting) {
                    requestAnimationFrame(() => {
                        (e.target as HTMLElement).classList.add("visible");
                    });
                }
            });
        };

        const observer = new IntersectionObserver(handleIntersect, {
            threshold: 0.08,
            rootMargin: "0px 0px -40px 0px",
        });

        const observe = () => {
            const els = document.querySelectorAll(".animate-in:not(.visible)");
            els.forEach((el) => observer.observe(el));
        };

        observe();

        const mutationObserver = new MutationObserver(observe);
        mutationObserver.observe(document.body, { childList: true, subtree: true });

        return () => {
            observer.disconnect();
            mutationObserver.disconnect();
        };
    }, []);
}

/* ═══════════════════════════════════════════
   Types
   ═══════════════════════════════════════════ */
interface Feature {
    icon: string;
    title: string;
    desc: string;
}

interface Step {
    num: string;
    title: string;
    desc: string;
}

interface Testimonial {
    stars: number;
    text: string;
    name: string;
    role: string;
    initials: string;
}

/* ═══════════════════════════════════════════
   Data
   ═══════════════════════════════════════════ */
const FEATURES: Feature[] = [
    {
        icon: "upload",
        title: "Multi-Modal Data Intake",
        desc: "Upload customer info in any format: images, videos, call recordings, emails, chat logs, and documents. Atlas extracts key requirements, flags missing information, and builds a structured travel profile automatically.",
    },
    {
        icon: "search",
        title: "Smart Template Matching & Validation",
        desc: "Atlas checks pre-built itineraries, historical templates, and partner packages. A validation agent surfaces destination constraints, visa requirements, and feasibility warnings before generation begins.",
    },
    {
        icon: "sparkles",
        title: "Triple Itinerary Generation",
        desc: "Three options every time: an original plan, a premium upgrade (+20% budget with enhanced stays & experiences), and a personalized variant for returning customers based on past trips and behavior.",
    },
    {
        icon: "refresh",
        title: "Agent-Customer Collaboration Loop",
        desc: "A continuous feedback cycle between agent, customer, and AI. Atlas validates every itinerary change in real time for feasibility. Review, share, iterate, and approve until the plan is perfect.",
    },
    {
        icon: "radio",
        title: "Booking & Real-Time Monitoring",
        desc: "Finalize bookings across flights, hotels, holiday packages, car rentals, and transfers via TBO APIs. Atlas tracks payments, monitors trip status, and sends live alerts with instant alternatives when disruptions occur.",
    },
    {
        icon: "user",
        title: "Persistent Customer Intelligence",
        desc: "Every interaction enriches a smart customer profile including travel history, preferences, budget patterns, past feedback, and behavioral insights, enabling increasingly personalized recommendations over time.",
    },
];

function FeatureIcon({ icon }: { icon: string }) {
    const props = { size: 22, strokeWidth: 1.8 };
    switch (icon) {
        case "upload": return <Upload {...props} />;
        case "search": return <Search {...props} />;
        case "sparkles": return <Sparkles {...props} />;
        case "refresh": return <RefreshCw {...props} />;
        case "radio": return <Radio {...props} />;
        case "user": return <User {...props} />;
        default: return null;
    }
}

const STEPS: Step[] = [
    {
        num: "1",
        title: "Intake & Extract",
        desc: "Upload customer data in any format. Atlas extracts requirements, builds a structured profile, highlights missing info, and flags visa requirements and destination constraints upfront.",
    },
    {
        num: "2",
        title: "Match & Validate",
        desc: "Atlas searches partner packages and pre-built templates. A validation agent confirms feasibility, compliance, and logical consistency before itinerary creation begins.",
    },
    {
        num: "3",
        title: "Generate & Collaborate",
        desc: "Receive up to three itinerary options: original, premium, and personalized. Share with the customer, collect feedback, and let Atlas validate every change in real time.",
    },
    {
        num: "4",
        title: "Book & Monitor",
        desc: "Finalize bookings across flights, hotels, packages, and transfers through TBO as the provider. Atlas monitors trips in real time and alerts agents and customers to any disruptions.",
    },
];

const TESTIMONIALS: Testimonial[] = [
    {
        stars: 5,
        text: "Atlas cut our itinerary planning time by 70%. We now handle triple the clients with the same team. The real-time validation alone has saved us from countless costly mistakes.",
        name: "Priya Sharma",
        role: "Senior Travel Agent, India",
        initials: "PS",
    },
    {
        stars: 5,
        text: "The multi-modal intake is a game-changer. Our customers send voice notes, WhatsApp screenshots, and PDFs. Atlas handles everything and we never miss a requirement again.",
        name: "David Chen",
        role: "Independent Travel Agent, Singapore",
        initials: "DC",
    },
    {
        stars: 5,
        text: "The premium itinerary upsell option alone increased our revenue by 35%. Customers love the upgrade suggestions and instant booking confirmation makes us look incredibly professional.",
        name: "Sarah Al-Rashid",
        role: "Travel Agent & Agency Owner, UAE",
        initials: "SA",
    },
];

/* ═══════════════════════════════════════════
   PAGE
   ═══════════════════════════════════════════ */
export default function Home() {
    const router = useRouter();
    const [scrolled, setScrolled] = useState<boolean>(false);
    const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);

    useScrollReveal();

    useEffect(() => {
        let ticking = false;
        const onScroll = (): void => {
            if (!ticking) {
                requestAnimationFrame(() => {
                    setScrolled(window.scrollY > 40);
                    ticking = false;
                });
                ticking = true;
            }
        };
        window.addEventListener("scroll", onScroll, { passive: true });
        return () => window.removeEventListener("scroll", onScroll);
    }, []);

    useEffect(() => {
        if (mobileMenuOpen) {
            document.body.style.overflow = "hidden";
        } else {
            document.body.style.overflow = "";
        }
        return () => { document.body.style.overflow = ""; };
    }, [mobileMenuOpen]);

    /* stat counters */
    const stat1 = useCountUp(10000);
    const stat2 = useCountUp(1);
    const stat3 = useCountUp(100);
    const stat4 = useCountUp(70);

    const goSignIn = (): void => {
        setMobileMenuOpen(false);
        router.push("/handler/sign-in");
    };

    const goSignUp = (): void => {
        setMobileMenuOpen(false);
        router.push("/handler/sign-up");
    };

    const scrollToSection = useCallback((e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
        e.preventDefault();
        setMobileMenuOpen(false);
        const el = document.getElementById(id);
        if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "start" });
        }
    }, []);

    return (
        <>
            {/* ─── SVG JOURNEY BACKGROUND ─── */}
            <JourneyBackground />

            {/* ─── NAVBAR ─── */}
            <nav className={`navbar ${scrolled ? "scrolled" : ""}`}>
                <div className="container">
                    <a href="#" className="nav-logo">
                        <span className="nav-logo-img-wrap">
                            <img src="/logo.png" alt="Atlas Logo" className="nav-logo-image" />
                        </span>
                        Atlas
                    </a>

                    <div className="nav-links">
                        <a href="#features" onClick={(e) => scrollToSection(e, "features")}>Features</a>
                        <a href="#how-it-works" onClick={(e) => scrollToSection(e, "how-it-works")}>How It Works</a>
                        <a href="#stats" onClick={(e) => scrollToSection(e, "stats")}>Stats</a>
                        <a href="#testimonials" onClick={(e) => scrollToSection(e, "testimonials")}>Testimonials</a>
                    </div>

                    <div className="nav-auth">
                        <button className="btn btn-ghost" onClick={goSignIn}>Sign In</button>
                        <button className="btn btn-primary" onClick={goSignUp}>Get Started</button>
                    </div>

                    <button
                        className="nav-mobile-toggle"
                        onClick={() => setMobileMenuOpen(true)}
                        aria-label="Open menu"
                    >
                        <Menu size={22} strokeWidth={2} />
                    </button>
                </div>
            </nav>

            {/* Mobile menu */}
            <div className={`mobile-menu ${mobileMenuOpen ? "open" : ""}`}>
                <button
                    className="mobile-menu-close"
                    onClick={() => setMobileMenuOpen(false)}
                    aria-label="Close menu"
                >
                    <X size={24} strokeWidth={2} />
                </button>
                <a href="#features" onClick={(e) => scrollToSection(e, "features")}>Features</a>
                <a href="#how-it-works" onClick={(e) => scrollToSection(e, "how-it-works")}>How It Works</a>
                <a href="#stats" onClick={(e) => scrollToSection(e, "stats")}>Stats</a>
                <a href="#testimonials" onClick={(e) => scrollToSection(e, "testimonials")}>Testimonials</a>
                <button className="btn btn-ghost" onClick={goSignIn}>Sign In</button>
                <button className="btn btn-primary" onClick={goSignUp}>Get Started</button>
            </div>

            {/* ─── HERO ─── */}
            <section className="hero">
                <div className="container">
                    <h1 className="hero-title">
                        Your Agency&apos;s{" "}
                        <span className="gradient-text">AI-Powered Travel Copilot</span>
                    </h1>

                    <p className="hero-description">
                        Atlas transforms travel agents into AI-augmented advisors. Automate
                        multi-modal intake, itinerary generation, real-time validation,
                        and bookings so you scale without sacrificing personalization.
                    </p>

                    <div className="hero-cta">
                        <button className="btn btn-primary" onClick={goSignUp}>
                            Start Free Trial
                            <ArrowRight size={16} strokeWidth={2.5} />
                        </button>
                        <button className="btn btn-secondary">
                            <Play size={15} strokeWidth={2.5} fill="currentColor" />
                            Watch Demo
                        </button>
                    </div>

                    <div className="hero-visual">
                        <div className="hero-visual-window">
                            <div className="hero-visual-topbar">
                                <span className="hero-visual-dot" />
                                <span className="hero-visual-dot" />
                                <span className="hero-visual-dot" />
                                <span className="hero-topbar-title">Atlas AI Copilot</span>
                                <span className="hero-topbar-status">
                                    <span className="hero-topbar-status-dot" />
                                    Live
                                </span>
                            </div>
                            <div className="hero-visual-content">

                                {/* ── LEFT: Chat Panel ── */}
                                <div className="hv-chat-panel">
                                    <div className="hv-chat-header">
                                        <div className="hv-chat-avatar ai logo">
                                            <img src="/logo.png" alt="Atlas Logo" />
                                        </div>
                                        <div>
                                            <div className="hv-chat-name">Atlas AI</div>
                                            <div className="hv-chat-sub">Travel Intelligence Engine</div>
                                        </div>
                                    </div>

                                    <div className="hv-chat-messages">
                                        <div className="hv-msg hv-msg-agent">
                                            <div className="hv-msg-avatar">A</div>
                                            <div className="hv-msg-bubble">
                                                Family of 4, Bali for 7 days, budget ₹2.5L, loves beaches &amp; culture. No spicy food 🙏
                                            </div>
                                        </div>
                                        <div className="hv-msg hv-msg-ai">
                                            <div className="hv-msg-avatar ai-av logo">
                                                <img src="/logo.png" alt="Voyage AI Logo" />
                                            </div>
                                            <div className="hv-msg-bubble ai-bubble">
                                                Profile built. Generating <strong>4 itinerary options</strong> via TBO — core, premium (+20%), budget & persona from past trips.
                                            </div>
                                        </div>
                                        <div className="hv-msg hv-msg-agent">
                                            <div className="hv-msg-avatar">A</div>
                                            <div className="hv-msg-bubble">
                                                Also check visa-on-arrival eligibility for all 4 travellers.
                                            </div>
                                        </div>
                                        <div className="hv-msg hv-msg-ai">
                                            <div className="hv-msg-avatar ai-av logo">
                                                <img src="/logo.png" alt="Atlas AI Logo" />
                                            </div>
                                            <div className="hv-msg-bubble ai-bubble hv-typing">
                                                <span /><span /><span />
                                            </div>
                                        </div>
                                    </div>

                                    <div className="hv-chat-input">
                                        <span className="hv-chat-input-icon"><Paperclip size={13} strokeWidth={2} /></span>
                                        <span className="hv-chat-placeholder">Add a note or attachment…</span>
                                        <span className="hv-chat-send"><Send size={11} strokeWidth={2.5} /></span>
                                    </div>
                                </div>

                                {/* ── RIGHT: Itinerary Result Card ── */}
                                <div className="hv-itinerary-panel">
                                    <div className="hv-itin-header">
                                        <div className="hv-itin-badge">✨ AI Generated</div>
                                        <div className="hv-itin-title">Bali Family Escape</div>
                                        <div className="hv-itin-meta">7 Days · 4 Pax · ₹2.4L</div>
                                    </div>

                                    <div className="hv-dest-strip">
                                        {[
                                            <Sunset key={0} size={18} strokeWidth={1.6} />,
                                            <TreePalm key={1} size={18} strokeWidth={1.6} />,
                                            <Landmark key={2} size={18} strokeWidth={1.6} />,
                                            <Waves key={3} size={18} strokeWidth={1.6} />,
                                        ].map((icon, i) => (
                                            <div key={i} className="hv-dest-chip">{icon}</div>
                                        ))}
                                    </div>

                                    <div className="hv-days">
                                        {[
                                            { day: "Day 1", place: "Seminyak Beach", tag: "Arrival" },
                                            { day: "Day 2\u20133", place: "Ubud Terraces", tag: "Culture" },
                                            { day: "Day 4\u20135", place: "Uluwatu Temple", tag: "Heritage" },
                                            { day: "Day 6\u20137", place: "Nusa Dua", tag: "Leisure" },
                                        ].map((d, i) => (
                                            <div key={i} className="hv-day-row">
                                                <div className="hv-day-dot" />
                                                <div className="hv-day-info">
                                                    <span className="hv-day-label">{d.day}</span>
                                                    <span className="hv-day-place">{d.place}</span>
                                                </div>
                                                <div className="hv-day-tag">{d.tag}</div>
                                            </div>
                                        ))}
                                    </div>

                                    <div className="hv-itin-footer">
                                        <span className="hv-itin-status">
                                            <CheckCircle size={13} strokeWidth={2} />
                                            Ready to Share
                                        </span>
                                        <span className="hv-itin-approve">Approve →</span>
                                    </div>
                                </div>

                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* ─── STATS ─── */}
            <section className="stats" id="stats">
                <div className="container">
                    <div className="stat-item" ref={stat1.ref}>
                        <div className="stat-value">{stat1.count.toLocaleString()}+</div>
                        <div className="stat-label">Travel Plans Generated</div>
                    </div>
                    <div className="stat-item" ref={stat2.ref}>
                        <div className="stat-value">{stat2.count}M+</div>
                        <div className="stat-label">Global Suppliers</div>
                    </div>
                    <div className="stat-item" ref={stat3.ref}>
                        <div className="stat-value">{stat3.count}+</div>
                        <div className="stat-label">Countries Covered</div>
                    </div>
                    <div className="stat-item" ref={stat4.ref}>
                        <div className="stat-value">{stat4.count}%</div>
                        <div className="stat-label">Planning Time Saved</div>
                    </div>
                </div>
            </section>

            {/* ─── FEATURES ─── */}
            <section className="features" id="features">
                <div className="container">
                    <div className="features-header">
                        <span className="section-label">Features</span>
                        <h2 className="section-title">
                            Everything You Need to{" "}
                            <span className="gradient-text">Scale Smarter</span>
                        </h2>
                        <p className="section-subtitle">
                            Atlas handles the complexity, from multi-modal intake to real-time
                            booking, so agents focus on relationships, not repetition.
                        </p>
                    </div>

                    <div className="features-grid">
                        {FEATURES.map((feature: Feature, i: number) => (
                            <div key={i} className="feature-card animate-in">
                                <div className="feature-icon"><FeatureIcon icon={feature.icon} /></div>
                                <h3>{feature.title}</h3>
                                <p>{feature.desc}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ─── HOW IT WORKS ─── */}
            <section className="how-it-works" id="how-it-works">
                <div className="container">
                    <div className="how-it-works-header">
                        <span className="section-label">How It Works</span>
                        <h2 className="section-title">
                            From <span className="gradient-text">Customer Brief to Confirmed Booking</span> in
                            Minutes
                        </h2>
                        <p className="section-subtitle">
                            A streamlined four-step AI workflow that turns raw customer inputs into
                            confirmed bookings, with a human agent in control at every step.
                        </p>
                    </div>

                    <div className="steps-grid">
                        {STEPS.map((step: Step, i: number) => (
                            <div key={i} className="step-card animate-in">
                                <div className="step-number">{step.num}</div>
                                <h3>{step.title}</h3>
                                <p>{step.desc}</p>
                                {i < 3 && <div className="step-connector" />}
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ─── TESTIMONIALS ─── */}
            <section className="testimonials" id="testimonials">
                <div className="container">
                    <div className="testimonials-header">
                        <span className="section-label">Testimonials</span>
                        <h2 className="section-title">
                            Trusted by <span className="gradient-text">Travel Agents Worldwide</span>
                        </h2>
                        <p className="section-subtitle">
                            Hear from travel professionals who are already scaling
                            their operations with Atlas.
                        </p>
                    </div>

                    <div className="testimonials-grid">
                        {TESTIMONIALS.map((t: Testimonial, i: number) => (
                            <div key={i} className="testimonial-card animate-in">
                                <div className="testimonial-stars">
                                    {Array.from({ length: t.stars }, (_, j: number) => (
                                        <span key={j}>★</span>
                                    ))}
                                </div>
                                <p className="testimonial-text">&ldquo;{t.text}&rdquo;</p>
                                <div className="testimonial-author">
                                    <div className="testimonial-avatar">{t.initials}</div>
                                    <div className="testimonial-author-info">
                                        <h4>{t.name}</h4>
                                        <span>{t.role}</span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ─── CTA ─── */}
            <section className="cta">
                <div className="container">
                    <div className="cta-card animate-in">
                        <span className="section-label">Get Started</span>
                        <h2 className="section-title">
                            Ready to <span className="gradient-text">Transform</span> Your
                            Agency?
                        </h2>
                        <p className="section-subtitle">
                            Join travel agents worldwide already using Atlas to automate
                            planning, grow revenue, and deliver exceptional experiences at scale.
                        </p>
                        <div className="cta-buttons">
                            <button className="btn btn-primary" onClick={goSignUp}>
                                Start Free Trial
                                <span>→</span>
                            </button>
                            <button className="btn btn-secondary">Contact Sales</button>
                        </div>
                    </div>
                </div>
            </section>

            {/* ─── FOOTER ─── */}
            <footer className="footer">
                <div className="container">
                    <div className="footer-grid">
                        <div className="footer-brand">
                            <a href="#" className="nav-logo">
                                <span className="nav-logo-img-wrap">
                                    <img src="/logo.png" alt="Atlas Logo" className="nav-logo-image" />
                                </span>
                                Atlas
                            </a>
                            <p>
                                AI-powered travel copilot helping agents automate
                                planning, enable real-time booking, and scale without compromise.
                            </p>
                        </div>

                        <div className="footer-column">
                            <h4>Product</h4>
                            <ul>
                                <li><a href="#features">Features</a></li>
                                <li><a href="#how-it-works">How It Works</a></li>
                                <li><a href="#">Pricing</a></li>
                                <li><a href="#">API Docs</a></li>
                            </ul>
                        </div>

                        <div className="footer-column">
                            <h4>Company</h4>
                            <ul>
                                <li><a href="#">About Us</a></li>
                                <li><a href="#">Careers</a></li>
                                <li><a href="#">Blog</a></li>
                                <li><a href="#">Contact</a></li>
                            </ul>
                        </div>

                        <div className="footer-column">
                            <h4>Legal</h4>
                            <ul>
                                <li><a href="#">Privacy Policy</a></li>
                                <li><a href="#">Terms of Service</a></li>
                                <li><a href="#">Cookie Policy</a></li>
                            </ul>
                        </div>
                    </div>

                    <div className="footer-bottom">
                        <p>© 2026 Atlas. Built for TBO Tek Hackathon. All rights reserved.</p>
                        <div className="footer-socials">
                            <a href="#" className="footer-social-link" aria-label="Twitter"><Twitter size={16} strokeWidth={1.8} /></a>
                            <a href="#" className="footer-social-link" aria-label="LinkedIn"><Linkedin size={16} strokeWidth={1.8} /></a>
                            <a href="#" className="footer-social-link" aria-label="GitHub"><Github size={16} strokeWidth={1.8} /></a>
                        </div>
                    </div>
                </div>
            </footer>
        </>
    );
}
