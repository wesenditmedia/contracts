// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./MockPancakePair.sol";

contract MockPancakeRouter {
    event MockEvent(uint256 value);

    address private immutable _weth;

    // See https://github.com/pancakeswap/pancake-smart-contracts/blob/master/projects/exchange-protocol/contracts/PancakeFactory.sol#L13
    mapping(address => mapping(address => address)) public getPair;

    constructor(
        address weth,
        address busd,
        address wsi,
        address wethPair,
        address busdPair
    ) {
        // BNB
        _weth = weth;

        // BNB <-> WSI
        getPair[weth][wsi] = wethPair;
        getPair[wsi][weth] = wethPair;

        // BUSD <-> WSI
        getPair[busd][wsi] = busdPair;
        getPair[wsi][busd] = busdPair;
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
        returns (uint256 amountToken, uint256 amountETH, uint256 liquidity)
    {
        address pair = getPair[_weth][token];

        IERC20(token).transferFrom(msg.sender, pair, amountTokenDesired);

        return (amountTokenDesired, msg.value, 0);
    }

    function swapExactTokensForETHSupportingFeeOnTransferTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) public {
        require(amountIn > 0, "MockPancakeRouter: Invalid input amount");

        address pair = getPair[path[0]][path[1]];

        IERC20(path[0]).transferFrom(msg.sender, pair, amountIn);
        MockPancakePair(pair).swap(path[1], to, amountIn);
        //payable(to).transfer(amountIn);
    }

    function swapExactETHForTokensSupportingFeeOnTransferTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) public payable {
        address pair = getPair[path[0]][path[1]];

        IERC20(path[0]).transfer(pair, msg.value);
        MockPancakePair(pair).swap(path[1], to, amountOutMin);
    }

    function swapExactTokensForTokensSupportingFeeOnTransferTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) public {
        address pair = getPair[path[0]][path[1]];

        IERC20(path[0]).transferFrom(msg.sender, pair, amountIn);
        MockPancakePair(pair).swap(
            path[1],
            to,
            amountOutMin > 0 ? amountOutMin : amountIn
        );
    }
}
