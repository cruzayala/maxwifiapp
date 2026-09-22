package com.ispmax.mobile.ui

import android.content.Context
import android.content.Intent
import android.net.Uri
import java.net.URLEncoder

/**
 * Telefonos de Republica Dominicana (809, 829 y 849), con las mismas reglas que la web
 * (src/app/pipes/phone.ts). Solo abren WhatsApp o el marcador: el tecnico revisa y envia.
 */
object PhoneLinks {
    /** Digitos internacionales (1 + 10 digitos) o null si no parece un numero valido. */
    fun international(phone: String?): String? {
        val digits = phone.orEmpty().filter(Char::isDigit)
        return when {
            digits.length == 10 && digits.take(3) in setOf("809", "829", "849") -> "1$digits"
            digits.length == 11 && digits.startsWith("1") && digits.substring(1, 4) in setOf("809", "829", "849") -> digits
            digits.length in 11..15 -> digits
            else -> null
        }
    }

    fun whatsappUrl(phone: String?, message: String? = null): String? {
        val intl = international(phone) ?: return null
        return if (message.isNullOrBlank()) "https://wa.me/$intl"
        else "https://wa.me/$intl?text=" + URLEncoder.encode(message, "UTF-8").replace("+", "%20")
    }

    fun telUri(phone: String?): String? = international(phone)?.let { "tel:+$it" }

    /** "18097723061" -> "(809) 772-3061" para mostrar. */
    fun format(phone: String?): String {
        val raw = phone.orEmpty().trim()
        val digits = raw.filter(Char::isDigit)
        val local = if (digits.length == 11 && digits.startsWith("1")) digits.substring(1) else digits
        return if (local.length == 10) "(${local.take(3)}) ${local.substring(3, 6)}-${local.substring(6)}" else raw
    }

    /** Abre WhatsApp (o el navegador si no esta instalado) con el mensaje ya escrito. */
    fun openWhatsapp(context: Context, phone: String?, message: String?): Boolean {
        val url = whatsappUrl(phone, message) ?: return false
        return runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }.isSuccess
    }

    /** Abre el marcador con el numero; no llama sin que el tecnico lo confirme. */
    fun openDialer(context: Context, phone: String?): Boolean {
        val uri = telUri(phone) ?: return false
        return runCatching { context.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse(uri)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }.isSuccess
    }
}
