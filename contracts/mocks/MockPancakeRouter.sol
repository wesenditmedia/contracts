// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./MockPancakePair.sol";

contract MockPancakeRouter {
    event MockEvent(uint256 value);

    address private immutable _weth;
    address private immutable _pair;

    constructor(address weth, address pair) {
        _weth = weth;
        _pair = pair;
    }

    function WETH() public view returns (address) {
        return _weth;
    }

    function addLiquidityETH(
        address token,
        uint256 amountTokenDesired,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline
    )
        public
        payable
        returns (
            uint256 amountToken,
            uint256 amountETH,
            uint256 liquidity
        )
    {
        IERC20(token).transferFrom(msg.sender, _pair, amountTokenDesired);
    }

    function swapExactTokensForETHSupportingFeeOnTransferTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) public {
        IERC20(path[0]).transferFrom(msg.sender, _pair, amountIn);
    }

    function swapExactETHForTokensSupportingFeeOnTransferTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) public payable {
        MockPancakePair(_pair).swap(path[1], msg.sender, amountOutMin);
    }

    function swapExactTokensForTokensSupportingFeeOnTransferTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) public {
        IERC20(path[0]).transferFrom(msg.sender, _pair, amountIn);
    }
}
