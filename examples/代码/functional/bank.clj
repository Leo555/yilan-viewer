(ns demo.bank
  (:require [clojure.string :as str]))

;; 使用 atom 和纯函数实现的简单账户系统

(defonce accounts (atom {}))

(defn open-account [id owner]
  (swap! accounts assoc id {:owner owner :balance 0 :history []}))

(defn- apply-tx [account {:keys [amount] :as tx}]
  (-> account
      (update :balance + amount)
      (update :history conj tx)))

(defn transfer! [from to amount]
  {:pre [(pos? amount)]}
  (swap! accounts
         (fn [accts]
           (when (< (get-in accts [from :balance]) amount)
             (throw (ex-info "余额不足" {:from from :amount amount})))
           (-> accts
               (update from apply-tx {:type :out :amount (- amount)})
               (update to apply-tx {:type :in :amount amount})))))

(defn report []
  (->> @accounts
       (sort-by (comp - :balance val))
       (map (fn [[id {:keys [owner balance]}]]
              (format "%-4s %-6s %8d" id owner balance)))
       (str/join \newline)))

(comment
  (open-account :a "张三")
  (open-account :b "李四")
  (swap! accounts update :a apply-tx {:type :in :amount 1000})
  (transfer! :a :b 300)
  (println (report)))
