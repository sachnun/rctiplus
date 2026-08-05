package com.rctiplus.tv.ui

import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.ViewGroup
import androidx.leanback.widget.ImageCardView
import androidx.leanback.widget.Presenter
import com.rctiplus.tv.R

/** Items rendered by [CardPresenter]. */
sealed interface CardItem {
    data class Channel(val slug: String, val name: String, val color: Int) : CardItem
    data class Replay(
        val epgId: Long,
        val title: String,
        val subtitle: String,
        val playable: Boolean,
    ) : CardItem
}

/** Leanback card for a channel or a catch-up program (image = flat color tile). */
class CardPresenter : Presenter() {

    override fun onCreateViewHolder(parent: ViewGroup): ViewHolder {
        val card = ImageCardView(parent.context)
        card.isFocusable = true
        card.isFocusableInTouchMode = true
        card.setMainImageDimensions(CARD_WIDTH, CARD_HEIGHT)
        return ViewHolder(card)
    }

    override fun onBindViewHolder(viewHolder: ViewHolder, item: Any?) {
        val card = viewHolder.view as ImageCardView
        val density = card.resources.displayMetrics.density
        when (val data = item as CardItem) {
            is CardItem.Channel -> {
                card.titleText = data.name
                card.contentText = card.context.getString(R.string.live_badge)
                card.mainImage = solid(data.color, density)
                card.alpha = 1f
            }
            is CardItem.Replay -> {
                card.titleText = data.title
                card.contentText = data.subtitle
                card.mainImage = solid(Color.rgb(30, 33, 42), density)
                card.alpha = if (data.playable) 1f else 0.45f
            }
        }
    }

    override fun onUnbindViewHolder(viewHolder: ViewHolder) {
        val card = viewHolder.view as ImageCardView
        card.badgeImage = null
        card.mainImage = null
        card.titleText = null
        card.contentText = null
    }

    private fun solid(color: Int, density: Float): GradientDrawable =
        GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = CORNER_RADIUS_DP * density
            setColor(color)
        }

    companion object {
        private const val CARD_WIDTH = 320
        private const val CARD_HEIGHT = 180
        private const val CORNER_RADIUS_DP = 8f
    }
}