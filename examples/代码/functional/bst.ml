(* 二叉搜索树：插入、查找、中序遍历 *)

type 'a tree =
  | Leaf
  | Node of 'a tree * 'a * 'a tree

let rec insert x = function
  | Leaf -> Node (Leaf, x, Leaf)
  | Node (l, v, r) as t ->
    if x < v then Node (insert x l, v, r)
    else if x > v then Node (l, v, insert x r)
    else t

let rec mem x = function
  | Leaf -> false
  | Node (l, v, r) -> x = v || (if x < v then mem x l else mem x r)

let to_list t =
  let rec go acc = function
    | Leaf -> acc
    | Node (l, v, r) -> go (v :: go acc r) l
  in
  go [] t

let () =
  let t = List.fold_left (fun acc x -> insert x acc) Leaf [ 5; 3; 8; 1; 4; 7; 9 ] in
  Printf.printf "有序：%s\n" (String.concat " " (List.map string_of_int (to_list t)));
  Printf.printf "包含 4？%b\n" (mem 4 t)
