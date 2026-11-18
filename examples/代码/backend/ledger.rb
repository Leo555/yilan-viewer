# frozen_string_literal: true

require 'json'
require 'time'

# 简单的记账本：按月汇总收支
class Ledger
  Entry = Struct.new(:date, :amount, :category, :note, keyword_init: true) do
    def income? = amount.positive?
  end

  include Enumerable

  def initialize
    @entries = []
  end

  def add(date:, amount:, category:, note: nil)
    @entries << Entry.new(date: Time.parse(date), amount: amount, category: category, note: note)
    self
  end

  def each(&block) = @entries.each(&block)

  def monthly_summary
    group_by { |e| e.date.strftime('%Y-%m') }
      .transform_values do |list|
        income, expense = list.partition(&:income?)
        { income: income.sum(&:amount), expense: expense.sum(&:amount).abs }
      end
  end
end

ledger = Ledger.new
ledger.add(date: '2026-10-01', amount: 12_000, category: :salary)
      .add(date: '2026-10-03', amount: -45.5, category: :food, note: '午饭')
      .add(date: '2026-11-01', amount: 12_000, category: :salary)
      .add(date: '2026-11-11', amount: -899, category: :shopping)

ledger.monthly_summary.each do |month, s|
  puts format('%<month>s  收入 %<in>10.2f  支出 %<out>10.2f', month: month, in: s[:income], out: s[:expense])
end

puts JSON.pretty_generate(ledger.map(&:to_h).first)
