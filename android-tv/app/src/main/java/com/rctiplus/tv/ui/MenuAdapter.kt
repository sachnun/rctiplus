package com.rctiplus.tv.ui

import android.content.Context
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.BaseAdapter
import android.widget.TextView
import com.rctiplus.tv.R
import com.rctiplus.tv.data.ReplayItem
import java.util.Calendar

/**
 * Adapter for the left menu's replay feed: date-section headers interleaved
 * with program rows (mirrors the web sidebar). Channels live in header views
 * owned by the activity, so this only deals with the Replay section.
 */
class MenuAdapter(private val ctx: Context) : BaseAdapter() {

    private sealed class Item {
        class Section(val date: String) : Item()
        class Program(val item: ReplayItem) : Item()
    }

    private val items = ArrayList<Item>()
    var activeEpgId: Long? = null
    var onProgramClick: ((ReplayItem) -> Unit)? = null

    /** Set the playing program and re-render affected rows. */
    fun setActive(epgId: Long?) {
        activeEpgId = epgId
        notifyDataSetChanged()
    }

    fun clear() {
        items.clear()
        notifyDataSetChanged()
    }

    fun appendSection(date: String, programs: List<ReplayItem>) {
        items.add(Item.Section(date))
        for (p in programs) items.add(Item.Program(p))
        notifyDataSetChanged()
    }

    /** First adapter index holding the given program (for scroll-into-view). */
    fun positionOf(epgId: Long): Int =
        items.indexOfFirst { it is Item.Program && it.item.epgId == epgId }

    override fun getCount(): Int = items.size
    override fun getItem(position: Int): Any = items[position]
    override fun getItemId(position: Int): Long = position.toLong()
    override fun getViewTypeCount(): Int = 2
    override fun getItemViewType(position: Int): Int =
        if (items[position] is Item.Section) 0 else 1

    override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
        val item = items[position]
        return when (item) {
            is Item.Section -> bindSection(item, convertView, parent)
            is Item.Program -> bindProgram(item, convertView, parent)
        }
    }

    private fun bindSection(section: Item.Section, cv: View?, parent: ViewGroup): View {
        val v = cv ?: LayoutInflater.from(ctx)
            .inflate(R.layout.item_section_header, parent, false)
        v.findViewById<TextView>(R.id.section_label).text = fmtDate(section.date)
        return v
    }

    private fun bindProgram(prog: Item.Program, cv: View?, parent: ViewGroup): View {
        val v = cv ?: LayoutInflater.from(ctx)
            .inflate(R.layout.row_replay, parent, false)
        val time = v.findViewById<TextView>(R.id.time)
        val title = v.findViewById<TextView>(R.id.title)
        val strip = v.findViewById<View>(R.id.strip)
        time.text = "${prog.item.start}\u2013${prog.item.end}"
        title.text = prog.item.title

        val active = activeEpgId == prog.item.epgId
        title.setTextColor(ctx.getColor(if (active) R.color.white else R.color.text_primary))
        time.setTextColor(ctx.getColor(if (active) R.color.text_active else R.color.text_muted))
        strip.visibility = if (active) View.VISIBLE else View.GONE

        v.setOnClickListener { onProgramClick?.invoke(prog.item) }
        return v
    }

    /* ----------------------------- date labels ----------------------------- */

    private val DAYS = arrayOf(
        "Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu",
    )
    private val MONTHS = arrayOf(
        "Januari", "Februari", "Maret", "April", "Mei", "Juni",
        "Juli", "Agustus", "September", "Oktober", "November", "Desember",
    )

    /** Relative day name or an absolute Indonesian long form ("Hari Ini",
        "Kemarin", "Besok", else "Senin, 5 Agustus" [+ year when different]). */
    private fun fmtDate(dateStr: String): String {
        val parts = dateStr.split("-")
        if (parts.size != 3) return dateStr
        val d = try {
            Calendar.getInstance().apply {
                clear()
                set(parts[0].toInt(), parts[1].toInt() - 1, parts[2].toInt())
            }
        } catch (e: NumberFormatException) {
            return dateStr
        }

        val today = Calendar.getInstance()
        today.set(Calendar.HOUR_OF_DAY, 0)
        today.set(Calendar.MINUTE, 0)
        today.set(Calendar.SECOND, 0)
        today.set(Calendar.MILLISECOND, 0)
        val diff =
            ((d.timeInMillis - today.timeInMillis) / 86_400_000L).toInt()

        return when {
            diff == 0 -> ctx.getString(R.string.today)
            diff == -1 -> ctx.getString(R.string.yesterday)
            diff == 1 -> ctx.getString(R.string.tomorrow)
            else -> {
                val label = "${DAYS[d.get(Calendar.DAY_OF_WEEK) - 1]}, " +
                    "${d.get(Calendar.DAY_OF_MONTH)} ${MONTHS[d.get(Calendar.MONTH)]}"
                if (d.get(Calendar.YEAR) == today.get(Calendar.YEAR)) label
                else "$label ${d.get(Calendar.YEAR)}"
            }
        }
    }
}