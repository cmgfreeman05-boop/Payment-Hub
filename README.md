# Payment Integration System

A full-stack billing and checkout demo built with React on the client and Express/TypeScript on the server. The app supports authentication, pricing catalogs, checkout sessions, subscription tracking, billing portal flows, and provider webhook reconciliation.

Copyright (c) 2026 Samuel Freeman <samuelfreeman17Ye@gmaiil.com>

## Overview

This project simulates a SaaS billing experience for digital products and subscriptions. It is designed to show how a secure payment flow can be implemented with:

- server-managed pricing
- CSRF-protected authenticated checkout requests
- idempotent order creation
- webhook-based payment verification
- subscription lifecycle tracking
- a local demo payment mode for testing without real charges

## Stack

- Frontend: React + Vite + TypeScript
- Backend: Express + TypeScript
- Database: Drizzle ORM with PGlite by default
- Payments: Stripe integration with a demo fallback mode
- Testing: Vitest

## Features

- User registration and login
- Session-based authentication with CSRF protection
- Product catalog and plan selection
- One-time purchases and recurring subscriptions
- Checkout session creation and redirect flow
- Billing history and subscription status pages
- Stripe webhook validation and replay protection
- Demo payment simulator for local development

## Local setup

1. Install dependencies:

   npm install

2. Copy the sample environment file and adjust values if needed:

   copy .env.example .env

3. Start the app:

   npm run dev

4. Open the frontend in the browser:

   http://localhost:5173/

The backend will run on:

- http://localhost:4000

## Demo mode

By default, the project starts in demo mode for local development, which avoids real payment charges. To use the real Stripe integration, set the environment variables in `.env`:

- `PAYMENT_GATEWAY=stripe`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

## Scripts

- `npm run dev` — runs the API and frontend together
- `npm run build` — builds both apps
- `npm run test` — runs the full test suite
- `npm run typecheck` — validates TypeScript across the repo
- `npm run db:migrate` — applies database migrations and seed data

## License

This project is licensed under the MIT License. See the `LICENSE` file for details.
