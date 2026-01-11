

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: item_tipo; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.item_tipo AS ENUM (
    'PRODUCTO',
    'SERVICIO'
);


ALTER TYPE public.item_tipo OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: clients; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.clients (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    nombre character varying(150) NOT NULL,
    telefono character varying(30),
    email character varying(255),
    ultima_visita timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    cedula character varying(30)
);


ALTER TABLE public.clients OWNER TO postgres;

--
-- Name: items; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    nombre character varying(150) NOT NULL,
    precio numeric(12,2) NOT NULL,
    tipo public.item_tipo NOT NULL,
    stock integer,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT items_precio_check CHECK ((precio >= (0)::numeric)),
    CONSTRAINT items_stock_check CHECK (((stock IS NULL) OR (stock >= 0))),
    CONSTRAINT items_stock_servicio_check CHECK ((((tipo = 'SERVICIO'::public.item_tipo) AND (stock IS NULL)) OR (tipo = 'PRODUCTO'::public.item_tipo)))
);


ALTER TABLE public.items OWNER TO postgres;

--
-- Name: sale_details; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.sale_details (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sale_id uuid NOT NULL,
    item_id uuid NOT NULL,
    cantidad integer NOT NULL,
    precio_unitario numeric(12,2) NOT NULL,
    subtotal numeric(12,2) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    nombre_producto character varying(150) NOT NULL,
    CONSTRAINT sale_details_cantidad_check CHECK ((cantidad > 0)),
    CONSTRAINT sale_details_precio_unitario_check CHECK ((precio_unitario >= (0)::numeric)),
    CONSTRAINT sale_details_subtotal_check CHECK ((subtotal >= (0)::numeric))
);


ALTER TABLE public.sale_details OWNER TO postgres;

--
-- Name: sales; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.sales (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    fecha timestamp with time zone DEFAULT now() NOT NULL,
    total numeric(12,2) NOT NULL,
    metodo_pago character varying(50) NOT NULL,
    client_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    client_nombre character varying(150),
    client_cedula character varying(30),
    CONSTRAINT sales_total_check CHECK ((total >= (0)::numeric))
);


ALTER TABLE public.sales OWNER TO postgres;

--
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    username character varying(100) NOT NULL,
    password text NOT NULL,
    role character varying(10) NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT users_role_check CHECK (((role)::text = ANY ((ARRAY['admin'::character varying, 'user'::character varying])::text[])))
);


ALTER TABLE public.users OWNER TO postgres;

--
-- Name: clients clients_cedula_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_cedula_unique UNIQUE (cedula);


--
-- Name: clients clients_email_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_email_unique UNIQUE (email);


--
-- Name: clients clients_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_pkey PRIMARY KEY (id);


--
-- Name: items items_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.items
    ADD CONSTRAINT items_pkey PRIMARY KEY (id);


--
-- Name: sale_details sale_details_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sale_details
    ADD CONSTRAINT sale_details_pkey PRIMARY KEY (id);


--
-- Name: sales sales_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sales
    ADD CONSTRAINT sales_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_username_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


--
-- Name: idx_sale_details_item_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sale_details_item_id ON public.sale_details USING btree (item_id);


--
-- Name: idx_sale_details_sale_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sale_details_sale_id ON public.sale_details USING btree (sale_id);


--
-- Name: idx_sales_client_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sales_client_id ON public.sales USING btree (client_id);


--
-- Name: idx_sales_fecha; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sales_fecha ON public.sales USING btree (fecha);


--
-- Name: sale_details sale_details_item_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sale_details
    ADD CONSTRAINT sale_details_item_fk FOREIGN KEY (item_id) REFERENCES public.items(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: sale_details sale_details_sale_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sale_details
    ADD CONSTRAINT sale_details_sale_fk FOREIGN KEY (sale_id) REFERENCES public.sales(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: sales sales_client_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sales
    ADD CONSTRAINT sales_client_fk FOREIGN KEY (client_id) REFERENCES public.clients(id) ON UPDATE CASCADE ON DELETE SET NULL;



