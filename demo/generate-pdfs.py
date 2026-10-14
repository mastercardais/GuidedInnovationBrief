#!/usr/bin/env python3
"""Generate sample PDFs for the Innovation Brief demo.
Scenario: Wattlebird Bank, Consumer Finance team, preparing for RBA interchange
fee reduction (Oct 1 2026) and its impact on rewards credit cards.
"""
from fpdf import FPDF
import os

OUT = os.path.dirname(os.path.abspath(__file__))

# ─── helpers ───────────────────────────────────────────────────────────────────
def new_pdf(title):
    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=20)
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 22)
    pdf.cell(0, 14, title, new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)
    return pdf

def heading(pdf, text):
    pdf.ln(4)
    pdf.set_font("Helvetica", "B", 14)
    pdf.cell(0, 10, text, new_x="LMARGIN", new_y="NEXT")
    pdf.ln(2)

def body(pdf, text):
    pdf.set_font("Helvetica", "", 11)
    pdf.multi_cell(0, 6, text)
    pdf.ln(2)

def bullet(pdf, text):
    pdf.set_font("Helvetica", "", 11)
    left = pdf.l_margin
    pdf.set_left_margin(left + 8)
    pdf.set_x(left + 8)
    pdf.multi_cell(0, 6, "- " + text)
    pdf.set_left_margin(left)

def save(pdf, name):
    path = os.path.join(OUT, name)
    pdf.output(path)
    print(f"  -> {name}")


# ═══════════════════════════════════════════════════════════════════════════════
# PDF 1: Internal strategy memo
# ═══════════════════════════════════════════════════════════════════════════════
pdf = new_pdf("Wattlebird Bank")
pdf.set_font("Helvetica", "", 13)
pdf.set_text_color(100, 100, 100)
pdf.cell(0, 8, "Consumer Finance Division  |  Internal Strategy Memo", new_x="LMARGIN", new_y="NEXT")
pdf.set_text_color(0, 0, 0)
pdf.ln(2)
pdf.set_font("Helvetica", "B", 16)
pdf.cell(0, 10, "Rewards Portfolio: Preparing for the RBA Interchange Cap", new_x="LMARGIN", new_y="NEXT")
pdf.set_font("Helvetica", "", 11)
pdf.set_text_color(120, 120, 120)
pdf.cell(0, 8, "August 2026  |  CONFIDENTIAL", new_x="LMARGIN", new_y="NEXT")
pdf.set_text_color(0, 0, 0)
pdf.ln(4)

heading(pdf, "1. Background")
body(pdf, "From 1 October 2026 the Reserve Bank of Australia will lower the consumer credit interchange fee cap from 0.80% to 0.30%. The weighted-average interchange on our consumer credit portfolio currently sits at approximately 0.52%, meaning the effective reduction to our interchange revenue will be significant.")
body(pdf, "Our rewards suite (Wattlebird Platinum, Wattlebird Black, Wattlebird Frequent Flyer) collectively accounts for 62% of consumer credit card revenue and 41% of total cards P&L. The interchange component funds approximately $38M annually in rewards redemption costs.")

heading(pdf, "2. Impact Analysis")
body(pdf, "Under the new cap, we estimate interchange revenue on the rewards portfolio will fall by $14-18M per annum. This shortfall cannot be fully absorbed by existing margins without either:")
bullet(pdf, "Reducing the earn rate (points per dollar spent) by 25-35%")
bullet(pdf, "Increasing annual card fees by $40-80 across tiers")
bullet(pdf, "Removing or restricting secondary benefits (lounge access, insurance, concierge)")
bullet(pdf, "Some combination of the above")
pdf.ln(2)
body(pdf, "Competitor intelligence suggests CBA and Westpac are modelling similar earn-rate reductions for Q4 2026. NAB is understood to be considering a fee-led response.")

heading(pdf, "3. Customer Sentiment Risk")
body(pdf, "Our NPS among Platinum and Black cardholders is +42. Internal research (May 2026) shows that 68% of rewards cardholders cite 'points earn rate' as the primary reason for holding the card, ahead of annual fee waiver (31%) and travel insurance (27%).")
body(pdf, "A 30% reduction in earn rate without a compensating value proposition is modelled to trigger:")
bullet(pdf, "15-20% increase in churn intent among Platinum holders")
bullet(pdf, "8-12 point NPS decline within 6 months")
bullet(pdf, "Negative media coverage, particularly via comparison sites (Canstar, Finder)")
pdf.ln(2)

heading(pdf, "4. Strategic Options Under Consideration")
body(pdf, "The Consumer Finance leadership team has identified three strategic directions, not mutually exclusive:")
pdf.ln(1)
pdf.set_font("Helvetica", "B", 11)
pdf.cell(0, 6, "Option A: Rebalance the value proposition", new_x="LMARGIN", new_y="NEXT")
pdf.set_font("Helvetica", "", 11)
body(pdf, "Reduce earn rate modestly (15-20%) but introduce new non-points benefits: enhanced purchase protection, lifestyle experiences, partner offers (dining, wellness). Aim to shift the value narrative from 'points per dollar' to 'membership value'.")

pdf.set_font("Helvetica", "B", 11)
pdf.cell(0, 6, "Option B: Tiered restructure", new_x="LMARGIN", new_y="NEXT")
pdf.set_font("Helvetica", "", 11)
body(pdf, "Collapse three rewards tiers into two. Entry tier with lower fee and reduced earn. Premium tier with maintained earn rate, higher annual fee ($399), and expanded experiential benefits. Accept some base-tier churn in exchange for stronger premium retention.")

pdf.set_font("Helvetica", "B", 11)
pdf.cell(0, 6, "Option C: Pivot to cashback", new_x="LMARGIN", new_y="NEXT")
pdf.set_font("Helvetica", "", 11)
body(pdf, "Replace points-based earning with statement credit cashback (0.5-1.0%). Lower cost-of-goods, simpler customer communication. Risk: loss of emotional engagement and Frequent Flyer partnership value.")

heading(pdf, "5. Engagement Request")
body(pdf, "We are seeking external support to rapidly explore and validate which combination of these options will resonate with our customer base and can be implemented by September 30. The engagement should help us understand customer willingness to pay for non-points benefits and identify specific experiences or perks that would offset the perceived loss of points value.")
body(pdf, "Stakeholders: Sarah Chen (GM Consumer Cards), Marcus Webb (Head of Loyalty & Partnerships), Priya Kaur (Customer Experience Lead).")

save(pdf, "Wattlebird-Rewards-Strategy-Memo.pdf")


# ═══════════════════════════════════════════════════════════════════════════════
# PDF 2: Customer research summary
# ═══════════════════════════════════════════════════════════════════════════════
pdf = new_pdf("Wattlebird Bank")
pdf.set_font("Helvetica", "", 13)
pdf.set_text_color(100, 100, 100)
pdf.cell(0, 8, "Customer Insights Team", new_x="LMARGIN", new_y="NEXT")
pdf.set_text_color(0, 0, 0)
pdf.ln(2)
pdf.set_font("Helvetica", "B", 16)
pdf.cell(0, 10, "Rewards Cardholder Sentiment: May 2026 Pulse", new_x="LMARGIN", new_y="NEXT")
pdf.set_font("Helvetica", "", 11)
pdf.set_text_color(120, 120, 120)
pdf.cell(0, 8, "n = 2,400 active rewards cardholders  |  Online panel, 12-18 May 2026", new_x="LMARGIN", new_y="NEXT")
pdf.set_text_color(0, 0, 0)
pdf.ln(4)

heading(pdf, "Key Findings")

pdf.set_font("Helvetica", "B", 11)
pdf.cell(0, 6, "1. Points earn rate drives retention", new_x="LMARGIN", new_y="NEXT")
pdf.set_font("Helvetica", "", 11)
body(pdf, "68% of respondents ranked 'points earned per dollar' as their #1 reason for holding the card. Annual fee waiver ranked #2 (31%), travel insurance #3 (27%), and lounge access #4 (19%).")

pdf.set_font("Helvetica", "B", 11)
pdf.cell(0, 6, "2. Awareness of RBA changes is low but rising", new_x="LMARGIN", new_y="NEXT")
pdf.set_font("Helvetica", "", 11)
body(pdf, "Only 22% of respondents were aware that interchange fee changes could affect their rewards. However, 58% said they would 'definitely reconsider' their card if earn rates dropped by more than 20%. Among high-value cardholders ($3,000+/month spend), this figure rose to 71%.")

pdf.set_font("Helvetica", "B", 11)
pdf.cell(0, 6, "3. Non-points benefits have latent appeal", new_x="LMARGIN", new_y="NEXT")
pdf.set_font("Helvetica", "", 11)
body(pdf, "When presented with a hypothetical 20% earn-rate reduction paired with new benefits, respondents were most receptive to:")
bullet(pdf, "Dining and entertainment offers / discounts (54% 'very interested')")
bullet(pdf, "Extended warranty / purchase protection (48%)")
bullet(pdf, "Priority access to concert and event tickets (39%)")
bullet(pdf, "Wellness benefits - gym discounts, telehealth (33%)")
bullet(pdf, "Airport lounge access upgrade (29% - but 72% among frequent travellers)")
pdf.ln(2)

pdf.set_font("Helvetica", "B", 11)
pdf.cell(0, 6, "4. Fee sensitivity varies by tier", new_x="LMARGIN", new_y="NEXT")
pdf.set_font("Helvetica", "", 11)
body(pdf, "Platinum holders: 44% would accept a $50 annual fee increase if benefits were 'meaningfully enhanced'. Black holders: 61% would accept up to $80 increase for premium experiential benefits. Frequent Flyer co-brand: only 18% would accept any fee increase - this segment is highly points-elastic.")

pdf.set_font("Helvetica", "B", 11)
pdf.cell(0, 6, "5. Communication tone matters", new_x="LMARGIN", new_y="NEXT")
pdf.set_font("Helvetica", "", 11)
body(pdf, "In message testing, framing the change as 'enhancing your card benefits' scored 3.8x higher on positive sentiment than 'adjusting the rewards program due to regulatory changes'. Customers respond to gain-framing, not loss-framing.")

heading(pdf, "Recommendations for Strategy Team")
bullet(pdf, "Do not lead communications with earn-rate reduction - lead with what's being added")
bullet(pdf, "Dining/entertainment offers are the strongest non-points lever - explore merchant partnerships")
bullet(pdf, "Consider a 'Founder' lock-in: existing cardholders keep current earn rate for 12 months as a loyalty gesture")
bullet(pdf, "Frequent Flyer co-brand requires separate strategy - points elasticity is too high for a fee-led approach")

save(pdf, "Wattlebird-Cardholder-Sentiment-May2026.pdf")


# ═══════════════════════════════════════════════════════════════════════════════
# PDF 3: RBA regulatory briefing (external, public)
# ═══════════════════════════════════════════════════════════════════════════════
pdf = new_pdf("Regulatory Briefing")
pdf.set_font("Helvetica", "B", 16)
pdf.cell(0, 10, "RBA Interchange Fee Reform: Impact on Rewards Cards", new_x="LMARGIN", new_y="NEXT")
pdf.set_font("Helvetica", "", 11)
pdf.set_text_color(120, 120, 120)
pdf.cell(0, 8, "Prepared for Wattlebird Bank Consumer Finance Team  |  July 2026", new_x="LMARGIN", new_y="NEXT")
pdf.set_text_color(0, 0, 0)
pdf.ln(4)

heading(pdf, "Summary of Changes (Effective 1 October 2026)")
body(pdf, "The RBA's Conclusions Paper (March 2026) finalised reforms to card payment interchange fees alongside a ban on merchant surcharging. The changes most relevant to consumer credit card issuers are:")

bullet(pdf, "Consumer credit interchange cap reduced from 0.80% to 0.30% (weighted average currently ~0.50%)")
bullet(pdf, "Debit/prepaid cap reduced from 10c/0.20% to 8c/0.16%")
bullet(pdf, "Commercial credit interchange unchanged at 0.80%")
bullet(pdf, "Foreign-issued card interchange capped at 1.00% from 1 April 2027")
bullet(pdf, "Merchant surcharging banned on all domestic Visa, Mastercard, and eftpos transactions")
pdf.ln(2)

heading(pdf, "Industry Revenue Impact")
body(pdf, "The RBA estimates approximately $660M per annum in reduced issuer interchange revenue, with the bulk falling on consumer credit card issuers. The regulator explicitly noted that consumer credit interchange has been funding cardholder rewards programs.")
body(pdf, "Total projected consumer savings: ~$910M/year from interchange reductions plus ~$1.6B/year from eliminated surcharges.")

heading(pdf, "Competitive Landscape")
body(pdf, "All four major banks (CBA, Westpac, NAB, ANZ) submitted to the RBA consultation opposing the reduction. Key themes from submissions:")
bullet(pdf, "Banks warned of reduced rewards, higher card fees, or higher interest rates")
bullet(pdf, "Some flagged potential withdrawal from commercial card segments")
bullet(pdf, "Smaller issuers raised viability concerns under compressed margins")
bullet(pdf, "Qantas Group submitted separately given its exposure through Frequent Flyer partnerships")
pdf.ln(2)
body(pdf, "No major bank has publicly announced specific product changes yet, but market expectations (based on analyst coverage and comparison site commentary) point to Q4 2026 earn-rate adjustments across the industry.")

heading(pdf, "Consumer Advocacy Position")
body(pdf, "CHOICE collected 24,000+ signatures supporting the surcharging ban, framing card payment as 'a fair, free way to pay.' Consumer groups have not yet focused public attention on the rewards erosion angle, but this is expected once banks announce changes.")
body(pdf, "Comparison sites (Canstar, Finder) have confirmed the timeline but not yet published detailed rewards impact analysis. This represents a window for proactive communication before third-party narrative-setting begins.")

heading(pdf, "Key Dates")
bullet(pdf, "1 October 2026: Surcharging ban + domestic interchange caps take effect")
bullet(pdf, "30 October 2026: Networks publish first quarterly interchange/scheme fee data")
bullet(pdf, "1 April 2027: Foreign card interchange cap + enhanced merchant statements")

save(pdf, "RBA-Interchange-Reform-Briefing.pdf")

print("\nDone. Three PDFs generated.")
