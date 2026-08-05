package com.rctiplus.tv

import android.os.Bundle
import androidx.fragment.app.FragmentActivity
import com.rctiplus.tv.ui.BrowseFragment

class MainActivity : FragmentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        if (savedInstanceState == null) {
            supportFragmentManager.beginTransaction()
                .replace(R.id.browse_container, BrowseFragment())
                .commit()
        }
    }
}