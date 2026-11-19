<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Models\Post;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class PostController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $posts = Post::query()
            ->with('author:id,name')
            ->when($request->string('q')->isNotEmpty(), function ($query) use ($request) {
                $query->where('title', 'like', '%' . $request->string('q') . '%');
            })
            ->latest()
            ->paginate(perPage: 20);

        return response()->json($posts);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'title' => ['required', 'string', 'max:120'],
            'body'  => ['required', 'string'],
            'tags'  => ['array'],
        ]);

        $post = $request->user()->posts()->create($data);

        return response()->json($post, 201);
    }

    public function destroy(Post $post): JsonResponse
    {
        $this->authorize('delete', $post);
        $post->delete();

        return response()->json(null, 204);
    }
}
