package demo

import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*

data class Weather(val city: String, val tempC: Double)

sealed class UiState {
    object Loading : UiState()
    data class Success(val data: List<Weather>) : UiState()
    data class Error(val message: String) : UiState()
}

class WeatherRepository {
    suspend fun fetch(city: String): Weather {
        delay(200)
        return Weather(city, (10..30).random() + 0.5)
    }
}

fun weatherFlow(repo: WeatherRepository, cities: List<String>): Flow<UiState> = flow {
    emit(UiState.Loading)
    val data = coroutineScope {
        cities.map { async { repo.fetch(it) } }.awaitAll()
    }
    emit(UiState.Success(data.sortedByDescending { it.tempC }))
}.catch { e -> emit(UiState.Error(e.message ?: "未知错误")) }

fun Double.format(digits: Int = 1) = "%.${digits}f".format(this)

fun main() = runBlocking {
    weatherFlow(WeatherRepository(), listOf("北京", "上海", "深圳")).collect { state ->
        when (state) {
            is UiState.Loading -> println("加载中…")
            is UiState.Success -> state.data.forEach { println("${it.city}: ${it.tempC.format()}°C") }
            is UiState.Error -> println("出错：${state.message}")
        }
    }
}
