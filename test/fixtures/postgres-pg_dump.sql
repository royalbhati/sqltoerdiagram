--
-- PostgreSQL database dump
--
SET statement_timeout = 0;
SET client_encoding = 'UTF8';
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;
CREATE TYPE public.order_status AS ENUM ('pending', 'paid', 'shipped');

CREATE TABLE public.accounts (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    email character varying(255) NOT NULL,
    tags text[] DEFAULT '{}'::text[],
    settings jsonb DEFAULT '{"a": "x;y"}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.orders (
    id bigint NOT NULL,
    account_id uuid NOT NULL,
    status public.order_status DEFAULT 'pending'::public.order_status NOT NULL,
    total numeric(12,2) NOT NULL,
    CONSTRAINT orders_total_check CHECK ((total >= (0)::numeric))
);

CREATE SEQUENCE public.orders_id_seq START WITH 1 INCREMENT BY 1;
ALTER SEQUENCE public.orders_id_seq OWNED BY public.orders.id;

CREATE TABLE public.order_items (
    order_id bigint NOT NULL,
    line_no integer NOT NULL,
    sku text NOT NULL,
    qty integer DEFAULT 1 NOT NULL
);

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_pkey PRIMARY KEY (order_id, line_no);
CREATE UNIQUE INDEX accounts_email_idx ON public.accounts USING btree (email);
ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);
