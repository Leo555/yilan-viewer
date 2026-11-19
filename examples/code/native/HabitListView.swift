import SwiftUI

struct Habit: Identifiable, Codable, Hashable {
    let id: UUID
    var name: String
    var streak: Int = 0
    var lastDone: Date?

    var doneToday: Bool {
        guard let lastDone else { return false }
        return Calendar.current.isDateInToday(lastDone)
    }
}

@Observable
final class HabitStore {
    var habits: [Habit] = [
        Habit(id: UUID(), name: "喝水 8 杯"),
        Habit(id: UUID(), name: "阅读 30 分钟", streak: 4),
    ]

    func check(_ habit: Habit) {
        guard let index = habits.firstIndex(of: habit), !habit.doneToday else { return }
        habits[index].streak += 1
        habits[index].lastDone = .now
    }
}

struct HabitListView: View {
    @State private var store = HabitStore()

    var body: some View {
        NavigationStack {
            List(store.habits) { habit in
                HStack {
                    Image(systemName: habit.doneToday ? "checkmark.circle.fill" : "circle")
                        .foregroundStyle(habit.doneToday ? .green : .secondary)
                    Text(habit.name)
                    Spacer()
                    Text("🔥 \(habit.streak)")
                        .monospacedDigit()
                }
                .contentShape(Rectangle())
                .onTapGesture { withAnimation { store.check(habit) } }
            }
            .navigationTitle("习惯打卡")
        }
    }
}

#Preview {
    HabitListView()
}
